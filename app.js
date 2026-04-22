const DATASET_PATHS = {
  phase: "./data/data_hypergraph/data_hypergraph/hypergraphs_phase.json",
  chapter: "./data/data_hypergraph/data_hypergraph/hypergraphs_chapter.json",
};

let DATA = null;
let PHASE_MAP = new Map();
let PLAYER_MAP = new Map();
let CHAPTER_MAP = new Map();
let PHASE_INDEX = new Map();
let AUTOPLAY_ORDER = [];
const PALETTE = ["#b3202a", "#f4a259", "#127475", "#6d597a", "#3a86ff", "#ff7f51", "#ef476f", "#2a9d8f"];

const state = {
  mode: "story",
  view: "both",
  activeChapterId: "overview",
  selectedPhaseId: null,
  activePlayerId: null,
  isAutoplay: false,
  autoplayTimer: null,
  presentationSpeed: 3200,
  filters: {
    outcome: "all",
    lane: "all",
    pattern: "all",
  },
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  void initApp();
});

async function initApp() {
  try {
    DATA = await loadDataset();
    buildIndexes();
    state.activeChapterId = DATA.chapters[0]?.id ?? "overview";
    state.selectedPhaseId = DATA.chapters[0]?.phaseIds[0] ?? DATA.phases[0]?.id ?? null;
    state.presentationSpeed = DATA.presentation?.defaultSpeedMs ?? 3200;
    cacheElements();
    renderStaticMeta();
    bindKeyboard();
    renderAll();
  } catch (error) {
    console.error("Failed to initialize Liverpool Hypergraph app.", error);
    document.body.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;background:#0f1720;color:#f6f7f8;font-family:'Segoe UI',sans-serif;padding:24px;">
        <section style="max-width:680px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:18px;padding:24px 28px;">
          <h1 style="margin:0 0 12px;">Dataset failed to load</h1>
          <p style="margin:0;line-height:1.6;">Check that the local server is running and that <code>${DATASET_PATHS.phase}</code> and <code>${DATASET_PATHS.chapter}</code> are reachable.</p>
        </section>
      </main>
    `;
  }
}

async function loadDataset() {
  try {
    const [phaseData, chapterData] = await Promise.all([fetchJson(DATASET_PATHS.phase), fetchJson(DATASET_PATHS.chapter)]);
    return normalizeDataset(phaseData, chapterData);
  } catch (error) {
    if (window.LIVERPOOL_HYPERGRAPH_DATA) {
      console.warn("Falling back to bundled dataset because the standardized JSON files could not be loaded.", error);
      return window.LIVERPOOL_HYPERGRAPH_DATA;
    }
    throw error;
  }
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function normalizeDataset(phaseData, chapterData) {
  const phases = (phaseData.hypergraphs ?? []).map(normalizePhase);
  const chapters = (chapterData.groups ?? []).map((group) => ({
    id: group.chapterId,
    title: group.title,
    mode: group.mode,
    phaseIds: group.phaseIds ?? [],
    summary: group.summary ?? "",
    annotations: group.annotations ?? [],
  }));

  return {
    match: {
      ...phaseData.match,
      dataSource: "Standardized hypergraph JSON derived from the original Liverpool storyboard dataset",
    },
    legend: {
      hypergraph: "Each translucent shape is one coordinated Liverpool attacking phase.",
      graph: "Pairwise links only show the pass-to-pass skeleton of the same move.",
    },
    players: phaseData.nodes ?? [],
    phases,
    chapters,
    summary: {
      selectedPhaseCount: phases.length,
      goalPhaseCount: phases.filter((phase) => phase.outcome === "goal").length,
      playerCount: (phaseData.nodes ?? []).length,
      chapterCount: chapters.length,
      averagePhaseSize: averageOf(phases.map((phase) => phase.uniquePlayerCount)),
    },
    summaryBreakdown: {
      outcomes: countBy(phases, "outcome"),
      lanes: countBy(phases, "lane"),
      patterns: countBy(phases, "pattern"),
    },
    presentation: {
      defaultSpeedMs: 3200,
      autoplayOrder: chapters.filter((chapter) => chapter.id !== "explore").map((chapter) => chapter.id),
    },
  };
}

function normalizePhase(phase) {
  const primaryHyperedge = phase.hyperedges?.[0] ?? {};
  return {
    id: phase.id,
    label: phase.title,
    minute: phase.time?.minute ?? "",
    absoluteSecond: phase.time?.absoluteSecond ?? 0,
    period: phase.time?.period ?? "1H",
    startSecond: phase.time?.startSecond ?? 0,
    duration: phase.time?.duration ?? 0,
    outcome: phase.tactics?.outcome ?? "shot",
    lane: phase.tactics?.lane ?? "center",
    pattern: phase.tactics?.pattern ?? "combination play",
    shotPlayerId: primaryHyperedge.shotPlayerId ?? null,
    shotPlayerName: primaryHyperedge.shotPlayerName ?? "Unknown",
    players: primaryHyperedge.members ?? [],
    uniquePlayerCount: primaryHyperedge.order ?? (primaryHyperedge.members?.length ?? 0),
    eventCount: phase.eventPath?.length ?? 0,
    progression: phase.tactics?.progression ?? phase.comparison?.progression ?? 0,
    impactScore: phase.tactics?.impactScore ?? 0,
    links: (phase.graphEdges ?? []).map(({ id, ...link }) => link),
    events: (phase.eventPath ?? []).map((event) => ({
      ...event,
      second: toPeriodSecond(event.absoluteSecond ?? 0, event.period ?? phase.time?.period ?? "1H"),
    })),
    comparison: phase.comparison ?? {
      hyperedgeOrder: primaryHyperedge.order ?? (primaryHyperedge.members?.length ?? 0),
      graphEdgeCount: (phase.graphEdges ?? []).length,
      potentialPairCount: 0,
      higherOrderDelta: 0,
      connectivityRatio: 0,
      progression: phase.tactics?.progression ?? 0,
      duration: phase.time?.duration ?? 0,
    },
  };
}

function buildIndexes() {
  PHASE_MAP = new Map(DATA.phases.map((phase) => [phase.id, phase]));
  PLAYER_MAP = new Map(DATA.players.map((player) => [player.id, player]));
  CHAPTER_MAP = new Map(DATA.chapters.map((chapter) => [chapter.id, chapter]));
  PHASE_INDEX = new Map(DATA.phases.map((phase, index) => [phase.id, index]));
  AUTOPLAY_ORDER =
    DATA.presentation?.autoplayOrder ?? DATA.chapters.filter((chapter) => chapter.id !== "explore").map((chapter) => chapter.id);
}

function cacheElements() {
  elements.modeSwitch = document.getElementById("mode-switch");
  elements.presentationControls = document.getElementById("presentation-controls");
  elements.summaryStrip = document.getElementById("summary-strip");
  elements.viewSwitch = document.getElementById("view-switch");
  elements.chapterList = document.getElementById("chapter-list");
  elements.outcomeFilters = document.getElementById("outcome-filters");
  elements.laneFilters = document.getElementById("lane-filters");
  elements.patternFilters = document.getElementById("pattern-filters");
  elements.phaseDetail = document.getElementById("phase-detail");
  elements.timeline = document.getElementById("timeline");
  elements.playerList = document.getElementById("player-list");
  elements.pitch = document.getElementById("pitch-svg");
  elements.chapterSummary = document.getElementById("chapter-summary");
  elements.comparisonBox = document.getElementById("comparison-box");
  elements.comparisonMetrics = document.getElementById("comparison-metrics");
  elements.annotationList = document.getElementById("annotation-list");
  elements.miniAnalytics = document.getElementById("mini-analytics");
  elements.takeawayBox = document.getElementById("takeaway-box");
}

function renderStaticMeta() {
  document.getElementById("match-title").textContent = DATA.match.title;
  document.getElementById("match-meta").textContent = `${DATA.match.season} · ${DATA.match.venue} · ${DATA.match.date}`;
}

function renderAll() {
  syncSelection();
  renderModeSwitch();
  renderPresentationControls();
  renderSummaryStrip();
  renderViewSwitch();
  renderChapterList();
  renderFilters();
  renderPhaseDetail();
  renderTimeline();
  renderPlayerList();
  renderMiniAnalytics();
  renderTakeawayBox();
  renderPitch();
  renderNarrativeCopy();
  renderComparisonMetrics();
  renderAnnotations();
}

function currentChapter() {
  return CHAPTER_MAP.get(state.activeChapterId) ?? DATA.chapters[0];
}

function currentPhase() {
  return PHASE_MAP.get(state.selectedPhaseId) ?? null;
}

function setMode(mode) {
  state.mode = mode;
  if (mode === "story") {
    state.activeChapterId = state.activeChapterId === "explore" ? "overview" : state.activeChapterId;
  } else {
    state.activeChapterId = "explore";
    stopAutoplay();
  }
}

function setChapter(chapterId) {
  state.activeChapterId = chapterId;
  setMode(chapterId === "explore" ? "explore" : "story");
  const chapter = currentChapter();
  if (!chapter.phaseIds.includes(state.selectedPhaseId)) {
    state.selectedPhaseId = chapter.phaseIds[0] ?? state.selectedPhaseId;
  }
}

function allFilteredPhases() {
  return DATA.phases.filter((phase) => {
    if (state.filters.outcome !== "all" && phase.outcome !== state.filters.outcome) {
      return false;
    }
    if (state.filters.lane !== "all" && phase.lane !== state.filters.lane) {
      return false;
    }
    if (state.filters.pattern !== "all" && phase.pattern !== state.filters.pattern) {
      return false;
    }
    if (state.mode === "explore" && state.activePlayerId && !phase.players.includes(state.activePlayerId)) {
      return false;
    }
    return true;
  });
}

function visiblePhases() {
  if (state.mode === "story") {
    return currentChapter()
      .phaseIds.map((phaseId) => PHASE_MAP.get(phaseId))
      .filter(Boolean);
  }
  return allFilteredPhases();
}

function syncSelection() {
  const visibleIds = new Set(visiblePhases().map((phase) => phase.id));
  if (!visibleIds.has(state.selectedPhaseId)) {
    state.selectedPhaseId = visiblePhases()[0]?.id ?? null;
  }
}

function renderModeSwitch() {
  const modes = [
    { id: "story", title: "Guided Story", note: "Narrated chapters for class presentation" },
    { id: "explore", title: "Free Explore", note: "Open filters, player focus, comparison" },
  ];
  elements.modeSwitch.innerHTML = "";
  modes.forEach((mode) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mode-button${state.mode === mode.id ? " active" : ""}`;
    button.innerHTML = `<strong>${mode.title}</strong><small>${mode.note}</small>`;
    button.addEventListener("click", () => {
      setMode(mode.id);
      state.activePlayerId = null;
      renderAll();
    });
    elements.modeSwitch.appendChild(button);
  });
}

function renderPresentationControls() {
  elements.presentationControls.innerHTML = "";
  const controls = [
    { id: "prev", label: "Previous", note: "Step back a chapter" },
    { id: "play", label: state.isAutoplay ? "Pause Story" : "Auto-Play", note: `${Math.round(state.presentationSpeed / 1000)}s pacing` },
    { id: "next", label: "Next", note: "Advance the story" },
  ];

  controls.forEach((control) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mode-button presentation-button${control.id === "play" && state.isAutoplay ? " active" : ""}`;
    button.innerHTML = `<strong>${control.label}</strong><small>${control.note}</small>`;
    button.addEventListener("click", () => {
      if (control.id === "prev") {
        stopAutoplay();
        advanceChapter(-1);
      } else if (control.id === "next") {
        stopAutoplay();
        advanceChapter(1);
      } else if (state.isAutoplay) {
        stopAutoplay();
      } else {
        startAutoplay();
      }
      renderAll();
    });
    elements.presentationControls.appendChild(button);
  });
}

function startAutoplay() {
  setMode("story");
  if (!AUTOPLAY_ORDER.includes(state.activeChapterId)) {
    state.activeChapterId = AUTOPLAY_ORDER[0];
  }
  state.isAutoplay = true;
  queueAutoplayStep();
}

function stopAutoplay() {
  state.isAutoplay = false;
  if (state.autoplayTimer) {
    window.clearTimeout(state.autoplayTimer);
    state.autoplayTimer = null;
  }
}

function queueAutoplayStep() {
  stopAutoplay();
  state.isAutoplay = true;
  state.autoplayTimer = window.setTimeout(() => {
    const currentIndex = AUTOPLAY_ORDER.indexOf(state.activeChapterId);
    if (currentIndex === AUTOPLAY_ORDER.length - 1) {
      stopAutoplay();
      renderAll();
      return;
    }
    advanceChapter(1);
    renderAll();
    if (state.isAutoplay) {
      queueAutoplayStep();
    }
  }, state.presentationSpeed);
}

function advanceChapter(direction) {
  if (state.mode !== "story") {
    setMode("story");
  }
  const currentIndex = Math.max(0, AUTOPLAY_ORDER.indexOf(state.activeChapterId));
  const nextIndex = Math.max(0, Math.min(AUTOPLAY_ORDER.length - 1, currentIndex + direction));
  state.activeChapterId = AUTOPLAY_ORDER[nextIndex];
  syncSelection();
}

function renderSummaryStrip() {
  const laneLeader = Object.entries(DATA.summaryBreakdown.lanes)
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? "center";
  const patternLeader = Object.entries(DATA.summaryBreakdown.patterns)
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? "combination play";
  const stats = [
    { label: "Hyperedges", value: DATA.summary.selectedPhaseCount, note: "shot-ending group actions", accent: "hyper" },
    { label: "Goal phases", value: DATA.summary.goalPhaseCount, note: "chapters that finish the move", accent: "goal" },
    { label: "Dominant lane", value: titleCaseLabel(laneLeader), note: "most repeated spatial channel", accent: "graph" },
    { label: "Main pattern", value: titleCaseLabel(patternLeader), note: "most common attacking template", accent: "amber" },
  ];

  elements.summaryStrip.innerHTML = "";
  stats.forEach((stat) => {
    const pill = document.createElement("div");
    pill.className = `stat-pill ${stat.accent ?? ""}`;
    pill.innerHTML = `<span>${stat.label}</span><strong>${stat.value}</strong><small>${stat.note}</small>`;
    elements.summaryStrip.appendChild(pill);
  });
}

function renderViewSwitch() {
  const views = [
    { id: "hypergraph", title: "Hypergraph", note: "See the full coordinated group" },
    { id: "graph", title: "Graph", note: "Reduce the move to pairwise edges" },
    { id: "both", title: "Both", note: "Compare abstraction and loss together" },
  ];

  elements.viewSwitch.innerHTML = "";
  views.forEach((view) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = state.view === view.id ? "active" : "";
    button.innerHTML = `<strong>${view.title}</strong><small>${view.note}</small>`;
    button.addEventListener("click", () => {
      state.view = view.id;
      renderAll();
    });
    elements.viewSwitch.appendChild(button);
  });
}

function renderChapterList() {
  elements.chapterList.innerHTML = "";
  DATA.chapters.forEach((chapter) => {
    if (chapter.id === "explore" && state.mode === "story") {
      return;
    }
    if (chapter.id !== "explore" && state.mode === "explore") {
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chapter-button${state.activeChapterId === chapter.id ? " active" : ""}`;
    button.innerHTML = `<strong>${chapter.title}</strong><span>${chapter.summary}</span>`;
    button.addEventListener("click", () => {
      stopAutoplay();
      setChapter(chapter.id);
      state.activePlayerId = null;
      renderAll();
    });
    elements.chapterList.appendChild(button);
  });
}

function renderFilters() {
  renderFilterRow(elements.outcomeFilters, ["all", "goal", "shot"], state.filters.outcome, (value) => {
    setMode("explore");
    state.filters.outcome = value;
    renderAll();
  });
  renderFilterRow(elements.laneFilters, ["all", "left", "center", "right"], state.filters.lane, (value) => {
    setMode("explore");
    state.filters.lane = value;
    renderAll();
  });
  const patterns = ["all", ...new Set(DATA.phases.map((phase) => phase.pattern))];
  renderFilterRow(elements.patternFilters, patterns, state.filters.pattern, (value) => {
    setMode("explore");
    state.filters.pattern = value;
    renderAll();
  });
}

function renderFilterRow(container, values, activeValue, onClick) {
  container.innerHTML = "";
  values.forEach((value) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `chip${activeValue === value ? " active" : ""}`;
    chip.textContent = value === "all" ? "All" : titleCaseLabel(value);
    chip.addEventListener("click", () => onClick(value));
    container.appendChild(chip);
  });
}

function renderPhaseDetail() {
  const phase = currentPhase();
  if (!phase) {
    elements.phaseDetail.innerHTML = `<div class="empty-state">No phases match the current filters.</div>`;
    return;
  }

  const summary = [
    `${phase.uniquePlayerCount}-player hyperedge`,
    `${phase.eventCount} actions`,
    `${phase.links.length} pairwise links`,
    `${phase.progression >= 0 ? "+" : ""}${phase.progression} progression`,
  ].join(" · ");

  const playerButtons = phase.players
    .map((playerId) => {
      const player = PLAYER_MAP.get(playerId);
      const active = state.activePlayerId === playerId ? " active" : "";
      return `<button type="button" class="player-token${active}" data-player="${playerId}">${player.name}</button>`;
    })
    .join("");

  const eventLines = phase.events
    .map(
      (event, index) => `
        <div class="event-line">
          <div class="event-index">${`${index + 1}`.padStart(2, "0")}</div>
          <div class="event-copy">
            <div class="event-row-top">
              <strong>${event.playerName}</strong>
              <time>${formatPhaseTime(event.second)}</time>
            </div>
            <span>${event.subEventName}${event.isGoal ? " · Goal" : event.isShot ? " · Shot" : ""}</span>
          </div>
        </div>
      `,
    )
    .join("");

  elements.phaseDetail.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="mini-label">${phase.minute} · ${phase.period}</p>
        <h3>${phase.shotPlayerName}</h3>
      </div>
      <div class="meta-badge ${phase.outcome === "goal" ? "goal" : ""}">${titleCaseLabel(phase.outcome)}</div>
    </div>
    <div class="detail-summary">${summary}</div>
    <div class="phase-meta">
      <div class="meta-badge">${titleCaseLabel(phase.pattern)}</div>
      <div class="meta-badge">${titleCaseLabel(phase.lane)} lane</div>
      <div class="meta-badge">${phase.duration.toFixed(1)} seconds</div>
      <div class="meta-badge">${phase.comparison.higherOrderDelta} missed pair relations</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-head">
        <span>Involved Players</span>
        <strong>${phase.uniquePlayerCount}</strong>
      </div>
      <div class="player-token-row">${playerButtons}</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-head">
        <span>Action Sequence</span>
        <strong>${phase.eventCount} steps</strong>
      </div>
      <div class="phase-events">${eventLines}</div>
    </div>
  `;

  elements.phaseDetail.querySelectorAll("[data-player]").forEach((button) => {
    button.addEventListener("click", () => {
      const playerId = Number(button.dataset.player);
      state.activePlayerId = state.activePlayerId === playerId ? null : playerId;
      renderAll();
    });
  });
}

function renderTimeline() {
  const phases = visiblePhases();
  elements.timeline.innerHTML = "";
  if (!phases.length) {
    elements.timeline.innerHTML = `<div class="empty-state">No attacking phase passes the current filters.</div>`;
    return;
  }

  phases.forEach((phase) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `timeline-card${state.selectedPhaseId === phase.id ? " active" : ""}`;
    button.innerHTML = `
      <div class="timeline-top">
        <div>
          <span class="timeline-minute">${phase.minute}</span>
          <strong>${phase.shotPlayerName}</strong>
        </div>
        <span class="timeline-badge ${phase.outcome}">${titleCaseLabel(phase.outcome)}</span>
      </div>
      <span class="timeline-subline">${titleCaseLabel(phase.pattern)} · ${titleCaseLabel(phase.lane)} lane</span>
      <div class="timeline-meter">
        <div class="timeline-meter-fill ${phase.outcome}" style="width:${phaseIntensity(phase)}%"></div>
      </div>
      <div class="timeline-meta-row">
        <span>${phase.uniquePlayerCount} players</span>
        <span>${phase.eventCount} actions</span>
        <span>${phase.links.length} links</span>
      </div>
    `;
    button.addEventListener("click", () => {
      state.selectedPhaseId = phase.id;
      renderAll();
    });
    elements.timeline.appendChild(button);
  });
}

function renderPlayerList() {
  const phases = visiblePhases();
  const counter = new Map();
  phases.forEach((phase) => {
    phase.players.forEach((playerId) => {
      counter.set(playerId, (counter.get(playerId) ?? 0) + 1);
    });
  });

  const players = [...counter.entries()]
    .sort((left, right) => right[1] - left[1] || PLAYER_MAP.get(left[0]).name.localeCompare(PLAYER_MAP.get(right[0]).name))
    .map(([playerId, count]) => ({ player: PLAYER_MAP.get(playerId), count }));

  elements.playerList.innerHTML = "";
  if (!players.length) {
    elements.playerList.innerHTML = `<div class="empty-state">No player remains visible under the current filters.</div>`;
    return;
  }
  const maxCount = Math.max(...players.map(({ count }) => count), 1);
  players.forEach(({ player, count }, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "player-item";
    const button = document.createElement("button");
    const share = Math.round((count / maxCount) * 100);
    button.type = "button";
    button.className = `player-card-button${state.activePlayerId === player.id ? " active" : ""}`;
    button.innerHTML = `
      <div class="player-card-top">
        <span class="player-rank">${`${index + 1}`.padStart(2, "0")}</span>
        <span class="player-card-badge">${count} phases</span>
      </div>
      <strong>${player.name}</strong>
      <span class="player-card-meta">${player.role} · avg position ${Math.round(player.avgX)}, ${Math.round(player.avgY)}</span>
      <div class="player-meter">
        <div class="player-meter-fill" style="width:${share}%"></div>
      </div>
    `;
    button.addEventListener("click", () => {
      state.activePlayerId = state.activePlayerId === player.id ? null : player.id;
      if (state.mode === "explore") {
        state.activeChapterId = "explore";
      }
      renderAll();
    });
    wrapper.appendChild(button);
    elements.playerList.appendChild(wrapper);
  });
}

function renderNarrativeCopy() {
  const chapter = currentChapter();
  const phase = currentPhase();
  if (!phase) {
    elements.chapterSummary.textContent = "No visible phase is currently selected.";
    elements.comparisonBox.textContent = "Adjust the filters to recover at least one attacking phase.";
    return;
  }

  elements.chapterSummary.textContent = chapter.summary;

  const metrics = phase.comparison;
  const headline = metrics.higherOrderDelta <= 1 ? "Near-graph attacking phase" : "Higher-order coordination stays visible";
  const directness =
    metrics.higherOrderDelta <= 1
      ? "This move is structurally close to a normal pass graph, which is why the two views feel similar."
      : `The graph only exposes ${metrics.graphEdgeCount} visible links, while the hypergraph preserves a ${metrics.hyperedgeOrder}-player action group and keeps ${metrics.higherOrderDelta} hidden pair possibilities in view.`;
  const playerFocus =
    state.activePlayerId && phase.players.includes(state.activePlayerId)
      ? ` The current focus highlights ${PLAYER_MAP.get(state.activePlayerId).name}'s role inside the same coordinated action.`
      : "";

  elements.comparisonBox.innerHTML = `<strong>${headline}</strong><p>${directness}${playerFocus}</p>`;
}

function renderComparisonMetrics() {
  const phase = currentPhase();
  if (!phase) {
    elements.comparisonMetrics.innerHTML = "";
    return;
  }

  const metrics = phase.comparison;
  const tiles = [
    { label: "Hyperedge order", value: metrics.hyperedgeOrder, note: "players inside the coordinated action", accent: "hyper" },
    { label: "Graph edges", value: metrics.graphEdgeCount, note: "visible pairwise links after flattening", accent: "graph" },
    { label: "Higher-order delta", value: metrics.higherOrderDelta, note: "relations lost when the group is reduced", accent: "amber" },
    { label: "Connectivity ratio", value: formatMetricValue(metrics.connectivityRatio), note: "density of the graph baseline", accent: "graph" },
  ];

  elements.comparisonMetrics.innerHTML = "";
  tiles.forEach((tile) => {
    const item = document.createElement("div");
    item.className = `metric-tile ${tile.accent}`;
    item.innerHTML = `<span>${tile.label}</span><strong>${tile.value}</strong><small>${tile.note}</small>`;
    elements.comparisonMetrics.appendChild(item);
  });
}

function currentAnnotations() {
  const chapter = currentChapter();
  return chapter.annotations ?? [];
}

function renderAnnotations() {
  const annotations = currentAnnotations();
  if (!annotations.length) {
    elements.annotationList.innerHTML = `<div class="empty-state">This view is exploratory, so there are no fixed story callouts. Use the filters to build your own explanation.</div>`;
    return;
  }

  elements.annotationList.innerHTML = "";
  annotations.forEach((annotation, index) => {
    const card = document.createElement("div");
    card.className = `annotation-card kind-${annotation.kind ?? "build"}`;
    card.innerHTML = `
      <div class="annotation-number">${index + 1}</div>
      <div>
        <div class="annotation-card-top">
          <strong>${annotation.title}</strong>
          <span class="annotation-kind">${titleCaseLabel(annotation.kind ?? "build")}</span>
        </div>
        <p>${annotation.body}</p>
      </div>
    `;
    card.addEventListener("click", () => {
      state.activePlayerId = state.activePlayerId === annotation.playerId ? null : annotation.playerId;
      renderAll();
    });
    elements.annotationList.appendChild(card);
  });
}

function renderMiniAnalytics() {
  const sections = [
    {
      title: "Outcomes",
      description: "How often the highlighted phases finish with a goal instead of only a shot.",
      slug: "outcomes",
      data: DATA.summaryBreakdown.outcomes,
      keys: ["goal", "shot"],
    },
    {
      title: "Lanes",
      description: "Which corridor Liverpool most often uses to carry the attack forward.",
      slug: "lanes",
      data: DATA.summaryBreakdown.lanes,
      keys: ["left", "center", "right"],
    },
    {
      title: "Patterns",
      description: "Recurring tactical templates inferred from the event sequence.",
      slug: "patterns",
      data: DATA.summaryBreakdown.patterns,
      keys: Object.keys(DATA.summaryBreakdown.patterns).sort((left, right) => DATA.summaryBreakdown.patterns[right] - DATA.summaryBreakdown.patterns[left]),
    },
  ];

  elements.miniAnalytics.innerHTML = "";
  sections.forEach((section) => {
    const maxValue = Math.max(...section.keys.map((key) => section.data[key] ?? 0), 1);
    const total = Math.max(section.keys.reduce((sum, key) => sum + (section.data[key] ?? 0), 0), 1);
    const block = document.createElement("div");
    block.className = `mini-chart mini-chart-${section.slug}`;
    block.innerHTML = `<h3>${section.title}</h3><p>${section.description}</p>`;
    section.keys.forEach((key) => {
      const value = section.data[key] ?? 0;
      const share = Math.round((value / total) * 100);
      const row = document.createElement("div");
      row.className = "distribution-row";
      row.innerHTML = `
        <div class="distribution-copy">
          <span class="distribution-label">${titleCaseLabel(key)}</span>
          <span class="distribution-share">${share}%</span>
        </div>
        <div class="distribution-track"><div class="distribution-bar ${section.slug}" style="width:${(value / maxValue) * 100}%"></div></div>
        <strong>${value}</strong>
      `;
      block.appendChild(row);
    });
    elements.miniAnalytics.appendChild(block);
  });
}

function renderTakeawayBox() {
  const phase = currentPhase();
  if (!phase) {
    elements.takeawayBox.textContent = "No phase selected.";
    return;
  }

  const takeaway =
    state.mode === "story"
      ? `Selected chapter: ${currentChapter().title}. This phase uses ${phase.uniquePlayerCount} players over ${phase.eventCount} actions and ends in a ${phase.outcome}.`
      : `Explore mode is live. The current phase travels through the ${phase.lane} lane and is tagged as ${phase.pattern}.`;
  elements.takeawayBox.innerHTML = `
    <div class="takeaway-top">
      <strong>${state.mode === "story" ? currentChapter().title : "Explore Mode"}</strong>
      <span>${phase.minute} · ${titleCaseLabel(phase.outcome)}</span>
    </div>
    <p>${takeaway}</p>
    <div class="takeaway-tags">
      <span>${titleCaseLabel(phase.pattern)}</span>
      <span>${titleCaseLabel(phase.lane)} lane</span>
      <span>${phase.uniquePlayerCount} players</span>
    </div>
  `;
}

function renderPitch() {
  const svg = elements.pitch;
  svg.innerHTML = "";
  const phases = visiblePhases();
  const renderPhases = state.view === "hypergraph" && currentPhase() ? [currentPhase()] : phases;
  if (!phases.length) {
    const message = svgElement("text", {
      x: 480,
      y: 310,
      "text-anchor": "middle",
      fill: "rgba(255,255,255,0.9)",
      "font-size": 22,
      "font-family": "Avenir Next, Segoe UI, sans-serif",
    });
    message.textContent = "No visible hyperedges for the current selection";
    svg.appendChild(message);
    return;
  }

  drawPitchFrame(svg);

  const visiblePlayerIds = new Set(renderPhases.flatMap((phase) => phase.players));
  const visiblePlayers = DATA.players.filter((player) => visiblePlayerIds.has(player.id));
  const basePositions = new Map(visiblePlayers.map((player) => [player.id, pitchPoint(player)]));
  const phasePositions = new Map(renderPhases.map((phase) => [phase.id, buildPhasePositions(phase, basePositions)]));

  if (state.view !== "graph") {
    renderPhases.forEach((phase) => drawHyperedge(svg, phase, phasePositions.get(phase.id)));
  }
  if (state.view !== "hypergraph") {
    renderPhases.forEach((phase) => drawGraphEdges(svg, phase, phasePositions.get(phase.id)));
  }

  drawSelectedPhaseRoute(svg);
  drawShotMarker(svg);
  drawAnnotationPins(svg, phasePositions.get(state.selectedPhaseId) ?? basePositions);
  const selectedPositions = phasePositions.get(state.selectedPhaseId) ?? new Map();
  visiblePlayers.forEach((player) => {
    const point = selectedPositions.get(player.id) ?? basePositions.get(player.id);
    drawNode(svg, player, renderPhases, point);
  });
}

function drawPitchFrame(svg) {
  const stripeGroup = svgElement("g");
  for (let index = 0; index < 6; index += 1) {
    stripeGroup.appendChild(
      svgElement("rect", {
        x: 60 + index * 140,
        y: 44,
        width: 70,
        height: 532,
        fill: index % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)",
      }),
    );
  }
  svg.appendChild(stripeGroup);

  svg.appendChild(
    svgElement("rect", {
      x: 650,
      y: 44,
      width: 250,
      height: 532,
      rx: 24,
      fill: "rgba(255, 255, 255, 0.04)",
    }),
  );
  svg.appendChild(
    svgElement("ellipse", {
      cx: 820,
      cy: 310,
      rx: 118,
      ry: 198,
      fill: "rgba(255, 214, 160, 0.06)",
    }),
  );

  const markings = [
    ["rect", { x: 60, y: 44, width: 840, height: 532, rx: 24, class: "pitch-line" }],
    ["line", { x1: 480, y1: 44, x2: 480, y2: 576, class: "pitch-line" }],
    ["line", { x1: 690, y1: 44, x2: 690, y2: 576, class: "pitch-guide" }],
    ["circle", { cx: 480, cy: 310, r: 72, class: "pitch-line" }],
    ["circle", { cx: 480, cy: 310, r: 2.5, fill: "rgba(236,248,238,0.92)" }],
    ["rect", { x: 60, y: 166, width: 120, height: 288, class: "pitch-line" }],
    ["rect", { x: 60, y: 228, width: 46, height: 164, class: "pitch-line" }],
    ["rect", { x: 780, y: 166, width: 120, height: 288, class: "pitch-line" }],
    ["rect", { x: 854, y: 228, width: 46, height: 164, class: "pitch-line" }],
    ["circle", { cx: 156, cy: 310, r: 2.5, fill: "rgba(236,248,238,0.92)" }],
    ["circle", { cx: 804, cy: 310, r: 2.5, fill: "rgba(236,248,238,0.92)" }],
  ];
  markings.forEach(([tag, attrs]) => svg.appendChild(svgElement(tag, attrs)));

  const zoneLabel = svgElement("text", {
    x: 700,
    y: 70,
    class: "pitch-guide-label",
  });
  zoneLabel.textContent = "FINAL THIRD";
  svg.appendChild(zoneLabel);

  const attackLabel = svgElement("text", {
    x: 822,
    y: 560,
    class: "attack-label",
  });
  attackLabel.textContent = "ATTACK →";
  svg.appendChild(attackLabel);
}

function drawHyperedge(svg, phase, positions) {
  if (!positions) {
    return;
  }
  const coords = phase.players.map((playerId) => positions.get(playerId)).filter(Boolean);
  if (!coords.length) {
    return;
  }

  if (state.view !== "hypergraph") {
    const pathData = buildHyperedgePath(coords);
    if (!pathData) {
      return;
    }
    const path = svgElement("path", {
      d: pathData,
      class: `hyperedge-path${state.selectedPhaseId === phase.id ? " is-selected" : ""}`,
      fill: hyperedgeFillColor(phase),
      stroke: hyperedgeStrokeColor(phase),
      "stroke-width": state.selectedPhaseId === phase.id ? 4.4 : 2,
    });
    svg.appendChild(path);

    if (state.selectedPhaseId === phase.id) {
      svg.appendChild(
        svgElement("path", {
          d: pathData,
          class: "hyperedge-outline",
        }),
      );
    }
    return;
  }

  const hub = {
    x: coords.reduce((sum, point) => sum + point.x, 0) / coords.length,
    y: coords.reduce((sum, point) => sum + point.y, 0) / coords.length,
  };

  coords.forEach((point, index) => {
    svg.appendChild(
      svgElement("path", {
        d: hyperedgeBranchPath(hub, point, index),
        class: `hyperedge-connector${state.selectedPhaseId === phase.id ? " is-selected" : ""}`,
        stroke: hyperedgeStrokeColor(phase),
        "stroke-width": hyperedgeStrokeWidth(phase),
        opacity: hyperedgeLineAlpha(phase),
      }),
    );
  });

  svg.appendChild(
    svgElement("circle", {
      cx: hub.x,
      cy: hub.y,
      r: 4.5,
      class: "hyperedge-centroid",
      fill: hyperedgeStrokeColor(phase),
    }),
  );
}

function drawHyperedgeLabel() {
  return;
}

function drawHyperedgeMembership() {
  return;
}

function drawGraphEdges(svg, phase, positions) {
  if (!positions) {
    return;
  }
  phase.links.forEach((link) => {
    const source = positions.get(link.source);
    const target = positions.get(link.target);
    if (!source || !target) {
      return;
    }
    const path = svgElement("path", {
      d: edgeCurve(source, target),
      class: "edge-path",
      stroke: `rgba(18, 116, 117, ${graphAlpha(phase)})`,
      "stroke-width": state.selectedPhaseId === phase.id ? 4.2 : 2.4,
    });
    svg.appendChild(path);
  });
}

function drawSelectedPhaseRoute(svg) {
  const phase = currentPhase();
  if (!phase) {
    return;
  }

  const routeOpacity = state.view === "hypergraph" ? 0.16 : state.view === "both" ? 0.38 : 0.78;
  const nodeOpacity = state.view === "hypergraph" ? 0.24 : state.view === "both" ? 0.5 : 0.92;

  phase.events.forEach((event, index) => {
    const start = eventPoint(event.start);
    const end = eventPoint(event.end);
    const glow = svgElement("line", {
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      class: "route-glow",
      opacity: routeOpacity,
    });
    svg.appendChild(glow);

    if (index < phase.events.length - 1) {
      const marker = svgElement("circle", {
        cx: end.x,
        cy: end.y,
        r: 4 + (index === phase.events.length - 2 ? 2 : 0),
        class: "route-node",
        opacity: nodeOpacity,
      });
      svg.appendChild(marker);
    }
  });
}

function drawShotMarker(svg) {
  const phase = currentPhase();
  if (!phase) {
    return;
  }
  if (state.view === "hypergraph") {
    return;
  }
  const lastEvent = phase.events[phase.events.length - 1];
  const point = eventPoint(lastEvent.start);
  svg.appendChild(svgElement("circle", { cx: point.x, cy: point.y, r: 28, class: "shot-pulse" }));
  svg.appendChild(svgElement("circle", { cx: point.x, cy: point.y, r: 10, class: "shot-core" }));
}

function drawAnnotationPins(svg, positions) {
  const phase = currentPhase();
  const annotations = currentAnnotations();
  if (!phase || !annotations.length) {
    return;
  }
  if (state.view === "hypergraph") {
    return;
  }

  annotations.forEach((annotation, index) => {
    const point = positions.get(annotation.playerId);
    if (!point) {
      return;
    }
    const offsetX = index % 2 === 0 ? 112 : -236;
    const offsetY = -108 + index * 92;
    const calloutX = clamp(point.x + offsetX, 90, 700);
    const calloutY = clamp(point.y + offsetY, 70, 520);
    const labelWidth = Math.min(220, Math.max(138, annotation.title.length * 7.1 + 26));

    svg.appendChild(
      svgElement("line", {
        x1: point.x,
        y1: point.y,
        x2: calloutX,
        y2: calloutY + 24,
        class: "annotation-line",
      }),
    );
    svg.appendChild(
      svgElement("circle", {
        cx: point.x,
        cy: point.y,
        r: 8,
        class: "annotation-anchor",
      }),
    );
    svg.appendChild(
      svgElement("rect", {
        x: calloutX,
        y: calloutY,
        rx: 14,
        width: labelWidth,
        height: 48,
        class: "annotation-pill",
      }),
    );
    const number = svgElement("text", {
      x: calloutX + 18,
      y: calloutY + 21,
      class: "annotation-index",
    });
    number.textContent = `${index + 1}`;
    svg.appendChild(number);

    const label = svgElement("text", {
      x: calloutX + 38,
      y: calloutY + 29,
      class: "annotation-label",
    });
    label.textContent = annotation.title;
    svg.appendChild(label);
  });
}

function drawNode(svg, player, phases, point) {
  if (!point) {
    return;
  }
  const inSelectedPhase = currentPhase()?.players.includes(player.id);
  const group = svgElement("g", {
    class: `node-group${nodeDimmed(player.id, phases) ? " is-dimmed" : ""}${inSelectedPhase ? " is-member" : ""}`,
    tabindex: 0,
    role: "button",
    "aria-label": player.name,
  });
  const selected = state.activePlayerId === player.id;
  const radius = inSelectedPhase ? 17 : 11 + Math.min(player.phaseCount, 6) * 0.65;
  const showLabel = state.view !== "hypergraph" || inSelectedPhase;

  group.appendChild(svgElement("circle", { cx: point.x, cy: point.y, r: radius + 10, class: "node-ring" }));
  group.appendChild(
    svgElement("circle", {
      cx: point.x,
      cy: point.y,
      r: radius,
      class: "node-core",
      fill: selected || inSelectedPhase ? "rgba(244, 162, 89, 0.98)" : "rgba(255,250,241,0.96)",
      stroke: selected ? "rgba(18,116,117,0.85)" : "rgba(255,255,255,0.78)",
      "stroke-width": selected ? 3.2 : 2.2,
    }),
  );

  if (showLabel) {
    const label = svgElement("text", {
      x: point.x,
      y: point.y - radius - 14,
      "text-anchor": "middle",
      class: "node-label",
    });
    label.textContent = player.name.replace("Roberto ", "Firmino ");
    group.appendChild(label);
  }

  group.addEventListener("click", () => {
    state.activePlayerId = state.activePlayerId === player.id ? null : player.id;
    renderAll();
  });
  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      state.activePlayerId = state.activePlayerId === player.id ? null : player.id;
      renderAll();
    }
  });

  svg.appendChild(group);
}

function nodeDimmed(playerId, phases) {
  if (state.view === "hypergraph") {
    return !currentPhase()?.players.includes(playerId);
  }
  if (!state.activePlayerId) {
    return false;
  }
  if (playerId === state.activePlayerId) {
    return false;
  }
  return !phases.some((phase) => phase.players.includes(state.activePlayerId) && phase.players.includes(playerId));
}

function hyperedgeAlpha(phase) {
  if (state.selectedPhaseId === phase.id) {
    return state.view === "hypergraph" ? 0.5 : 0.36;
  }
  if (state.activePlayerId && !phase.players.includes(state.activePlayerId)) {
    return 0.06;
  }
  if (state.view === "hypergraph") {
    return 0.06;
  }
  return visiblePhases().length === 1 ? 0.28 : 0.15;
}

function hyperedgeFillColor(phase) {
  if (state.view === "hypergraph" && state.selectedPhaseId === phase.id) {
    return "rgba(74, 211, 221, 0.14)";
  }
  return phaseColor(phase.id, hyperedgeAlpha(phase));
}

function hyperedgeStrokeColor(phase) {
  if (state.view === "hypergraph" && state.selectedPhaseId === phase.id) {
    return "rgba(92, 226, 236, 0.72)";
  }
  return phaseColor(phase.id, 0.84);
}

function hyperedgeStrokeWidth(phase) {
  if (state.selectedPhaseId === phase.id) {
    return 5.2;
  }
  return 2.6;
}

function hyperedgeLineAlpha(phase) {
  if (state.selectedPhaseId === phase.id) {
    return 0.98;
  }
  return 0.22;
}

function graphAlpha(phase) {
  if (state.selectedPhaseId === phase.id) {
    return 0.92;
  }
  if (state.activePlayerId && !phase.players.includes(state.activePlayerId)) {
    return 0.1;
  }
  return visiblePhases().length === 1 ? 0.76 : 0.4;
}

function phaseColor(phaseId, alpha) {
  const color = PALETTE[PHASE_INDEX.get(phaseId) % PALETTE.length];
  return hexToRgba(color, alpha);
}

function countBy(items, key) {
  return items.reduce((accumulator, item) => {
    const value = item[key];
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {});
}

function averageOf(values) {
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : 0;
}

function toPeriodSecond(absoluteSecond, period) {
  return period === "2H" ? absoluteSecond - 45 * 60 : absoluteSecond;
}

function pitchPoint(player) {
  const inner = { x: 88, y: 72, width: 784, height: 476 };
  return {
    x: inner.x + (player.avgX / 100) * inner.width,
    y: inner.y + (player.avgY / 100) * inner.height,
  };
}

function eventPoint(position) {
  const inner = { x: 88, y: 72, width: 784, height: 476 };
  return {
    x: inner.x + (position.x / 100) * inner.width,
    y: inner.y + (position.y / 100) * inner.height,
  };
}

function buildHyperedgePath(points) {
  if (!points.length) {
    return "";
  }
  if (points.length === 1) {
    return circlePath(points[0], 28);
  }
  if (points.length === 2) {
    return capsulePath(points[0], points[1], 28);
  }
  const hull = convexHull(points);
  if (!hull.length) {
    return "";
  }
  const centroid = {
    x: hull.reduce((sum, point) => sum + point.x, 0) / hull.length,
    y: hull.reduce((sum, point) => sum + point.y, 0) / hull.length,
  };
  const inflated = hull.map((point) => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    const length = Math.hypot(dx, dy) || 1;
    const padding = 18;
    return {
      x: point.x + (dx / length) * padding,
      y: point.y + (dy / length) * padding,
    };
  });
  return polygonPath(inflated);
}

function buildPhasePositions(phase, fallbackPositions) {
  const phasePositions = new Map();
  phase.players.forEach((playerId) => {
    const samples = phase.events
      .filter((event) => event.playerId === playerId)
      .flatMap((event) => [event.start, event.end])
      .filter((position) => position && Number.isFinite(position.x) && Number.isFinite(position.y))
      .filter((position) => !(position.x === 0 && position.y === 0));

    if (samples.length) {
      const average = {
        x: samples.reduce((sum, position) => sum + position.x, 0) / samples.length,
        y: samples.reduce((sum, position) => sum + position.y, 0) / samples.length,
      };
      phasePositions.set(playerId, eventPoint(average));
      return;
    }

    const fallback = fallbackPositions.get(playerId);
    if (fallback) {
      phasePositions.set(playerId, fallback);
    }
  });
  return phasePositions;
}

function polygonPath(points) {
  if (!points.length) {
    return "";
  }
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 1; index < points.length; index += 1) {
    path += ` L ${points[index].x.toFixed(2)} ${points[index].y.toFixed(2)}`;
  }
  return `${path} Z`;
}

function hyperedgeBranchPath(hub, point, index) {
  const dx = point.x - hub.x;
  const dy = point.y - hub.y;
  const distance = Math.hypot(dx, dy) || 1;
  const nx = -dy / distance;
  const ny = dx / distance;
  const bend = Math.min(26, Math.max(10, distance * 0.12));
  const direction = index % 2 === 0 ? 1 : -1;
  const cx = hub.x + dx * 0.55 + nx * bend * direction;
  const cy = hub.y + dy * 0.55 + ny * bend * direction;
  return `M ${hub.x.toFixed(2)} ${hub.y.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}

function capsulePath(a, b, radius) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy * radius;
  const py = ux * radius;
  const startTop = { x: a.x + px, y: a.y + py };
  const startBottom = { x: a.x - px, y: a.y - py };
  const endTop = { x: b.x + px, y: b.y + py };
  const endBottom = { x: b.x - px, y: b.y - py };
  return [
    `M ${startTop.x} ${startTop.y}`,
    `L ${endTop.x} ${endTop.y}`,
    `A ${radius} ${radius} 0 0 1 ${endBottom.x} ${endBottom.y}`,
    `L ${startBottom.x} ${startBottom.y}`,
    `A ${radius} ${radius} 0 0 1 ${startTop.x} ${startTop.y}`,
    "Z",
  ].join(" ");
}

function circlePath(center, radius) {
  return [
    `M ${center.x - radius} ${center.y}`,
    `A ${radius} ${radius} 0 1 0 ${center.x + radius} ${center.y}`,
    `A ${radius} ${radius} 0 1 0 ${center.x - radius} ${center.y}`,
    "Z",
  ].join(" ");
}

function edgeCurve(source, target) {
  const mx = (source.x + target.x) / 2;
  const my = (source.y + target.y) / 2;
  const curveHeight = Math.max(18, Math.min(72, Math.abs(source.x - target.x) * 0.18));
  return `M ${source.x} ${source.y} Q ${mx} ${my - curveHeight} ${target.x} ${target.y}`;
}

function convexHull(points) {
  const unique = [...new Map(points.map((point) => [`${point.x}-${point.y}`, point])).values()].sort((left, right) =>
    left.x === right.x ? left.y - right.y : left.x - right.x,
  );
  if (unique.length <= 1) {
    return unique;
  }
  const cross = (origin, a, b) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const lower = [];
  unique.forEach((point) => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  });
  const upper = [];
  [...unique].reverse().forEach((point) => {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  });
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function bindKeyboard() {
  document.addEventListener("keydown", (event) => {
    if (event.target && /input|textarea|select/i.test(event.target.tagName)) {
      return;
    }
    if (event.key === "ArrowRight") {
      cyclePhase(1);
    }
    if (event.key === "ArrowLeft") {
      cyclePhase(-1);
    }
    if (event.key.toLowerCase() === "g") {
      state.view = "graph";
      renderAll();
    }
    if (event.key.toLowerCase() === "h") {
      state.view = "hypergraph";
      renderAll();
    }
    if (event.key.toLowerCase() === "b") {
      state.view = "both";
      renderAll();
    }
  });
}

function cyclePhase(direction) {
  const phases = visiblePhases();
  if (!phases.length) {
    return;
  }
  const currentIndex = phases.findIndex((phase) => phase.id === state.selectedPhaseId);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + phases.length) % phases.length;
  state.selectedPhaseId = phases[nextIndex].id;
  renderAll();
}

function formatPhaseTime(second) {
  const whole = Math.max(0, Math.round(second));
  const minute = Math.floor(whole / 60);
  const remaining = `${whole % 60}`.padStart(2, "0");
  return `${minute}:${remaining}`;
}

function titleCaseLabel(value) {
  return String(value)
    .split(/[\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function phaseIntensity(phase) {
  return clamp(Math.round(phase.progression * 1.55 + phase.links.length * 5), 26, 100);
}

function formatMetricValue(value) {
  return typeof value === "number" ? value.toFixed(2).replace(/\.00$/, "") : value;
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const value = clean.length === 3 ? clean.split("").map((digit) => digit + digit).join("") : clean;
  const channel = parseInt(value, 16);
  const red = (channel >> 16) & 255;
  const green = (channel >> 8) & 255;
  const blue = channel & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
