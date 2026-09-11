"use client";
import { memo, useEffect, useRef, useState } from "react";
import type { BrainItem, ItemKind } from "@/lib/workspace/model";
export const SYMBOLS: Record<ItemKind, string> = {
  note: "≡",
  task: "✓",
  idea: "✧",
  person: "◉",
  project: "▱",
  decision: "◇",
  expense: "↗",
  payment: "↙",
  shopping: "+",
  habit: "↻",
};
const PAGE_SIZE = 18;

/** One coordinate system for both cards and links, with bounded rendering and genuine scale zoom. */
export const ContextMap = memo(function ContextMap({
  items,
  select,
  filtered,
  clearFilters,
  ready,
  memoryEnabled,
}: {
  items: BrainItem[];
  select: (id: string) => void;
  filtered: boolean;
  clearFilters: () => void;
  ready: boolean;
  memoryEnabled: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(1, entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setPage(0);
    viewport.current?.scrollTo(0, 0);
  }, [items]);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const shown = items.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const columns = width < 480 ? 1 : width < 760 ? 2 : 3;
  const cardWidth = Math.min(240, width / columns - 40);
  const height = Math.max(300, Math.ceil(shown.length / columns) * 154 + 30);
  const positions = new Map(
    shown.map((item, index) => [
      item.id,
      {
        x: (width / columns) * ((index % columns) + 0.5),
        y: 84 + Math.floor(index / columns) * 154,
      },
    ]),
  );
  const links = shown.flatMap((item) =>
    item.links
      .filter((id) => positions.has(id))
      .map((id) => ({
        key: `${item.id}-${id}`,
        from: positions.get(item.id)!,
        to: positions.get(id)!,
      })),
  );
  function changePage(next: number) {
    setPage(next);
    viewport.current?.scrollTo(0, 0);
  }
  return (
    <div className="canvas-frame">
      <div className="canvas-label">
        <span className="eyebrow">YOUR CONTEXT, CONNECTED</span>
        <span aria-live="polite">
          {items.length} {memoryEnabled ? "workspace" : "session"} items ·{" "}
          {links.length} visible links
        </span>
      </div>
      <div
        ref={viewport}
        className="canvas-scroll"
        tabIndex={items.length ? 0 : undefined}
        role="region"
        aria-label="Context map. Scroll to explore, or use Tab to open a record."
      >
        {!ready ? (
          <div className="map-loading" role="status">
            <span className="loading-orbit" aria-hidden="true" />
            Opening your workspace…
          </div>
        ) : shown.length ? (
          <div
            className="map-extent"
            style={{ width: width * zoom, height: height * zoom }}
          >
            <div
              className="node-map"
              style={{
                width,
                height,
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
              }}
            >
              <svg
                className="connections-svg"
                aria-hidden="true"
                viewBox={`0 0 ${width} ${height}`}
              >
                {links.map(({ key, from, to }) => (
                  <line key={key} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
                ))}
              </svg>
              {shown.map((item) => {
                const position = positions.get(item.id)!;
                return (
                  <button
                    key={item.id}
                    className={`thought-node ${item.status === "done" ? "complete" : ""}`}
                    onClick={() => select(item.id)}
                    style={{
                      left: position.x,
                      top: position.y,
                      width: cardWidth,
                    }}
                    title={item.title}
                  >
                    <span className="node-kind">
                      <span aria-hidden="true">{SYMBOLS[item.kind]}</span>{" "}
                      {item.kind}
                      <span className="node-link-count">
                        {item.links.length > 0 ? `${item.links.length} ↗` : ""}
                      </span>
                    </span>
                    <strong>{item.title}</strong>
                    <span className="node-meta">
                      {item.status === "done"
                        ? "Completed"
                        : item.due
                          ? `Due ${new Date(item.due).toLocaleDateString()}`
                          : new Date(item.createdAt).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric" },
                            )}
                      <span aria-hidden="true">↗</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="canvas-empty">
            {filtered ? (
              <>
                <span className="empty-search-symbol" aria-hidden="true">
                  ⌕
                </span>
                <h2>No matching thoughts.</h2>
                <p>Try a shorter search or a different record type.</p>
                <button className="text-button amber" onClick={clearFilters}>
                  Clear search & filters
                </button>
              </>
            ) : (
              <>
                <div className="empty-constellation" aria-hidden="true">
                  <span className="empty-tag tag-a">an idea</span>
                  <span className="empty-tag tag-b">a next step</span>
                  <span className="empty-tag tag-c">something to remember</span>
                  <div className="empty-center">
                    Your space
                    <br />
                    <small>starts with a thought</small>
                  </div>
                </div>
                <p>No invented memories. Just what you choose to save.</p>
                <button
                  className="text-button amber"
                  onClick={() =>
                    document.getElementById("capture-input")?.focus()
                  }
                >
                  Capture your first thought ↑
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="canvas-footer">
        {pages > 1 ? (
          <div className="map-pagination" aria-label="Map pages">
            <button
              disabled={currentPage === 0}
              aria-label="Previous map page"
              onClick={() => changePage(currentPage - 1)}
            >
              ←
            </button>
            <span aria-live="polite">
              {currentPage + 1} / {pages}
            </span>
            <button
              disabled={currentPage === pages - 1}
              aria-label="Next map page"
              onClick={() => changePage(currentPage + 1)}
            >
              →
            </button>
          </div>
        ) : (
          <span>Only the connections you make.</span>
        )}
        <div className="map-zoom">
          <button
            disabled={zoom <= 0.8 || !items.length}
            aria-label="Zoom out"
            onClick={() =>
              setZoom((z) => Math.max(0.8, Math.round((z - 0.2) * 10) / 10))
            }
          >
            −
          </button>
          <button
            className="zoom-reset"
            aria-label="Reset map zoom"
            onClick={() => setZoom(1)}
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            disabled={zoom >= 2 || !items.length}
            aria-label="Zoom in"
            onClick={() =>
              setZoom((z) => Math.min(2, Math.round((z + 0.2) * 10) / 10))
            }
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
});
