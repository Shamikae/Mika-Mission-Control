import { useEffect, useRef } from 'react';

// Uses the lower-level `force-graph` package directly (already present in
// node_modules as react-force-graph's own rendering engine) instead of the
// `react-force-graph` React wrapper — that wrapper's package bundles VR/AR
// support via aframe-extras, which references a global `AFRAME` that this
// app never defines, throwing at module-evaluation time and leaving the
// dynamically-imported component stuck in its loading state forever (with
// no console error, since the failure happens inside webpack's chunk
// evaluation). The vanilla `force-graph` package has no such dependency and
// is genuinely browser-only (it references `window` at the top level), so
// it's imported inside useEffect — which never runs during SSR — rather
// than needing next/dynamic's ssr:false at all.

const GROUP_COLOR = {
  package: '#c9a84c', production_job: '#60a5fa', artifact: '#4ade80', publish_job: '#a78bfa',
};

export default function RelationshipGraph({ data, width = 360, height = 340 }) {
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let instance = null;

    import('force-graph').then(({ default: ForceGraph }) => {
      if (cancelled || !containerRef.current) return;
      instance = ForceGraph()(containerRef.current)
        .graphData(data)
        .width(width)
        .height(height)
        .backgroundColor('#07090f')
        .nodeColor(node => GROUP_COLOR[node.group] || '#8892a4')
        .nodeRelSize(4)
        .nodeVal(node => node.val || 4)
        .nodeLabel(node => node.name)
        .linkColor(() => 'rgba(201,168,76,0.25)')
        .linkWidth(1)
        .cooldownTicks(80);
    }).catch(() => { /* graph is a visual extra — never block the rest of the page on it */ });

    return () => {
      cancelled = true;
      if (instance) instance._destructor?.();
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [data, width, height]);

  return <div ref={containerRef} style={{ width, height }} />;
}
