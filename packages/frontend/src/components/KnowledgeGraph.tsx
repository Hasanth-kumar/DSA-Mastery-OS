import { buildHardPrerequisiteEdges, buildTopicGraphEdges } from "@dsa/intelligence";
import { drag as d3drag } from "d3-drag";
import { easeCubicOut } from "d3-ease";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
// Side effect: adds .transition() to d3 selections.
import "d3-transition";
import { useEffect, useRef } from "react";
import { EmptyState, GraphIllustration } from "./EmptyState.js";
import type { Topic } from "../types/api.js";

interface GraphNode extends SimulationNodeDatum {
  id: string;
  name: string;
  confidence: number;
  status: Topic["status"];
  isWeakArea: boolean;
  isDue: boolean;
}

type GraphLink = SimulationLinkDatum<GraphNode>;

interface Props {
  topics: Topic[];
  /** Currently focused topic — drives the dim/highlight transition (5.4). */
  selectedId?: string | null;
  /** Node click → side panel with stats and "study this now" (5.4). */
  onNodeClick?: (topicId: string) => void;
  /** P7.2 (`curriculumV2`): draw only the approved hard prerequisites. */
  hardPrerequisitesOnly?: boolean;
}

/* CSS variables so the graph follows the active theme. */
const GRAPH_COLORS = {
  mastered: "var(--success)",
  inProgress: "var(--warning)",
  notStarted: "var(--text-subtle)",
  weakArea: "var(--danger)",
} as const;

function nodeColor(node: GraphNode): string {
  if (node.isWeakArea) return GRAPH_COLORS.weakArea;
  if (node.status === "Mastered") return GRAPH_COLORS.mastered;
  if (node.status === "In progress") return GRAPH_COLORS.inProgress;
  return GRAPH_COLORS.notStarted;
}

function nodeRadius(node: GraphNode): number {
  return 8 + (node.confidence / 100) * 10;
}

export function KnowledgeGraph({ topics, selectedId, onNodeClick, hardPrerequisitesOnly }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ref = useRef<SVGSVGElement>(null);
  const fitRef = useRef<(() => void) | null>(null);
  // Latest click handler, read through a ref so changing it never rebuilds the
  // simulation (which would discard the settled layout).
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  // Apply the focus highlight; defined inside the build effect, called from the
  // selection effect so the two share one implementation.
  const applyHighlightRef = useRef<(id: string | null) => void>(() => {});
  const selectedIdRef = useRef<string | null>(selectedId ?? null);

  useEffect(() => {
    if (!ref.current || !containerRef.current || topics.length === 0) return;

    const containerEl = containerRef.current;
    // Mutable so ResizeObserver can keep viewBox / forces aligned with the box.
    let width = containerEl.clientWidth || 720;
    let height = containerEl.clientHeight || 480;
    const now = Date.now();

    // d3 transitions are JS-driven, so the CSS reduced-motion guard can't reach
    // them — collapse durations to 0 here instead.
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dur = (ms: number) => (reduceMotion ? 0 : ms);

    const nodes: GraphNode[] = topics.map((t) => ({
      id: t.id,
      name: t.name,
      confidence: t.confidence,
      status: t.status,
      isWeakArea: t.isWeakArea,
      isDue:
        t.status !== "Not started" &&
        (t.nextRevisionAt == null || new Date(t.nextRevisionAt).getTime() <= now),
    }));

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links: GraphLink[] = [];
    // Adjacency for the focus transition: who lights up when a node is picked.
    const adjacency = new Map<string, Set<string>>();
    const connect = (a: string, b: string) => {
      (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    };

    const edges = hardPrerequisitesOnly
      ? buildHardPrerequisiteEdges(topics)
      : buildTopicGraphEdges(topics);
    for (const { from, to } of edges) {
      if (nodeIds.has(from) && nodeIds.has(to)) {
        links.push({ source: from, target: to } as GraphLink);
        connect(from, to);
        connect(to, from);
      }
    }

    const svg = select(ref.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const g = svg.append("g");

    const zoom = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });

    svg.call(zoom);

    /** Zoom/pan so every node (plus its label) is visible. Applied without a
     * transition: rAF-driven animations stall in background tabs and would
     * leave the viewport in a half-applied state. */
    const fitView = () => {
      const xs = nodes.map((n) => n.x ?? 0);
      const ys = nodes.map((n) => n.y ?? 0);
      if (xs.length === 0) return;
      // Labels extend right of the node; pad generously on that side.
      const pad = 40;
      const minX = Math.min(...xs) - pad;
      const maxX = Math.max(...xs) + pad + 90;
      const minY = Math.min(...ys) - pad;
      const maxY = Math.max(...ys) + pad;
      const boundsW = Math.max(maxX - minX, 1);
      const boundsH = Math.max(maxY - minY, 1);
      const scale = Math.min(1.5, 0.95 / Math.max(boundsW / width, boundsH / height));
      const tx = width / 2 - scale * (minX + boundsW / 2);
      const ty = height / 2 - scale * (minY + boundsH / 2);
      svg.call(zoom.transform, zoomIdentity.translate(tx, ty).scale(scale));
    };
    fitRef.current = fitView;

    // Collision radius covers the node plus a slice of its right-hand label —
    // enough to stop label pile-ups without inflating the layout.
    const collideRadius = (d: GraphNode) =>
      Math.min(nodeRadius(d) + 8 + d.name.length * 1.9, 68);

    const simulation = forceSimulation(nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(95),
      )
      .force("charge", forceManyBody().strength(-160))
      .force("center", forceCenter(width / 2, height / 2))
      // Gentle gravity shaped to the wide canvas: stronger on y so the
      // cloud spreads horizontally instead of ballooning vertically.
      .force("x", forceX(width / 2).strength(0.045))
      .force("y", forceY(height / 2).strength(0.16))
      .force("collision", forceCollide<GraphNode>().radius(collideRadius).strength(0.8));

    // Settle most of the layout synchronously so the first paint is already
    // organized and can be fitted right away.
    simulation.tick(90);

    const link = g
      .append("g")
      .attr("stroke", "var(--border)")
      .attr("stroke-opacity", 0.9)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 1.5);

    const drag = d3drag<SVGGElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
        event.sourceEvent.stopPropagation();
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    const node = g
      .append("g")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes)
      .join("g")
      .call(drag);

    // Highlighted ring marks topics with due revisions (5.4).
    node
      .filter((d) => d.isDue)
      .append("circle")
      .attr("r", (d) => nodeRadius(d) + 5)
      .attr("fill", "none")
      .attr("stroke", "var(--accent)")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4 3")
      .attr("opacity", 0.9);

    node
      .append("circle")
      .attr("class", "graph-node-circle")
      .attr("r", (d) => nodeRadius(d))
      .attr("fill", (d) => nodeColor(d))
      .attr("stroke", "var(--bg-card)")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        onNodeClickRef.current?.(d.id);
      });

    // Hover: grow the node and bloom a soft coral ring (not a hard border).
    node
      .on("mouseenter", function (_event, d) {
        select(this)
          .select<SVGCircleElement>("circle.graph-node-circle")
          .transition()
          .duration(dur(160))
          .attr("r", nodeRadius(d) + 3)
          .attr("stroke", "var(--accent)")
          .attr("stroke-width", 3);
      })
      .on("mouseleave", function (_event, d) {
        select(this)
          .select<SVGCircleElement>("circle.graph-node-circle")
          .transition()
          .duration(dur(200))
          .attr("r", nodeRadius(d))
          .attr("stroke", "var(--bg-card)")
          .attr("stroke-width", 2);
      });

    node
      .append("text")
      .attr("class", "graph-node-label")
      .text((d) => d.name)
      .attr("x", (d) => nodeRadius(d) + 6)
      .attr("y", 4);

    node.append("title").text(
      (d) => `${d.name}\n${d.status} · ${d.confidence}% confidence`,
    );

    const linkNode = (endpoint: GraphLink["source"]): GraphNode => {
      return typeof endpoint === "object" ? endpoint : nodes.find((n) => n.id === endpoint)!;
    };

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => linkNode(d.source).x ?? 0)
        .attr("y1", (d) => linkNode(d.source).y ?? 0)
        .attr("x2", (d) => linkNode(d.target).x ?? 0)
        .attr("y2", (d) => linkNode(d.target).y ?? 0);

      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    /**
     * Hero focus transition (5.4): dim everything unrelated, brighten the
     * focused node's edges, and draw a coral ring around the selection.
     */
    const applyHighlight = (id: string | null) => {
      node.selectAll("circle.graph-focus-ring").remove();

      if (!id) {
        node.transition().duration(dur(220)).style("opacity", 1);
        link
          .transition()
          .duration(dur(220))
          .attr("stroke", "var(--border)")
          .attr("stroke-opacity", 0.9)
          .attr("stroke-width", 1.5);
        return;
      }

      const related = new Set(adjacency.get(id) ?? []);
      related.add(id);

      node
        .transition()
        .duration(dur(220))
        .style("opacity", (d) => (related.has(d.id) ? 1 : 0.15));

      link
        .transition()
        .duration(dur(220))
        .attr("stroke", (d) =>
          linkNode(d.source).id === id || linkNode(d.target).id === id
            ? "var(--accent)"
            : "var(--border)",
        )
        .attr("stroke-opacity", (d) =>
          linkNode(d.source).id === id || linkNode(d.target).id === id ? 1 : 0.25,
        )
        .attr("stroke-width", (d) =>
          linkNode(d.source).id === id || linkNode(d.target).id === id ? 2.5 : 1.5,
        );

      // Coral ring that draws itself clockwise around the selected node.
      const selectedNode = node.filter((d) => d.id === id);
      const datum = selectedNode.datum();
      if (datum) {
        const ringR = nodeRadius(datum) + 7;
        const circumference = 2 * Math.PI * ringR;
        selectedNode
          .append("circle")
          .attr("class", "graph-focus-ring")
          .attr("r", ringR)
          .attr("fill", "none")
          .attr("stroke", "var(--accent)")
          .attr("stroke-width", 2.5)
          .attr("stroke-linecap", "round")
          .attr("transform", "rotate(-90)")
          .attr("stroke-dasharray", circumference)
          .attr("stroke-dashoffset", circumference)
          .transition()
          .duration(dur(420))
          .ease(easeCubicOut)
          .attr("stroke-dashoffset", 0);
      }
    };
    applyHighlightRef.current = applyHighlight;

    // First paint is pre-settled (tick warm-up above), so fit immediately,
    // then materialize the graph with a soft fade rather than a hard snap.
    fitView();
    g.style("opacity", 0).transition().duration(dur(600)).style("opacity", 1);
    applyHighlight(selectedIdRef.current);

    // Keep the simulation canvas matched to the box (panel open/close, resize).
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect;
      if (!next || next.width < 10 || next.height < 10) return;
      if (Math.abs(next.width - width) < 1 && Math.abs(next.height - height) < 1) {
        return;
      }
      width = next.width;
      height = next.height;
      svg.attr("viewBox", `0 0 ${width} ${height}`);
      simulation.force("center", forceCenter(width / 2, height / 2));
      simulation.force("x", forceX(width / 2).strength(0.045));
      simulation.force("y", forceY(height / 2).strength(0.16));
      fitView();
    });
    ro.observe(containerEl);

    return () => {
      ro.disconnect();
      simulation.stop();
      svg.on(".zoom", null);
      fitRef.current = null;
      applyHighlightRef.current = () => {};
    };
  }, [topics, hardPrerequisitesOnly]);

  // React to selection changes without rebuilding the simulation.
  useEffect(() => {
    selectedIdRef.current = selectedId ?? null;
    applyHighlightRef.current(selectedId ?? null);
  }, [selectedId]);

  if (topics.length === 0) {
    return (
      <div className="card">
        <EmptyState
          illustration={<GraphIllustration />}
          title="No topics to visualize"
          hint="Topics appear here once they're synced from Notion."
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="graph-container card">
      <button
        type="button"
        className="graph-fit-btn"
        onClick={() => fitRef.current?.()}
        title="Fit all topics in view"
      >
        ⊡ Fit view
      </button>
      <svg ref={ref} className="chart-svg" />
      <div className="graph-legend">
        <span><i style={{ background: GRAPH_COLORS.mastered }} /> Mastered</span>
        <span><i style={{ background: GRAPH_COLORS.inProgress }} /> In progress</span>
        <span><i style={{ background: GRAPH_COLORS.notStarted }} /> Not started</span>
        <span><i style={{ background: GRAPH_COLORS.weakArea }} /> Weak area</span>
        <span><i style={{ background: "transparent", border: "2px dashed var(--accent)" }} /> Revision due</span>
      </div>
    </div>
  );
}
