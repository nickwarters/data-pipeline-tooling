// @ts-check

const MARK_SELECTOR = '[data-cora-chart-mark="true"]';
const MARK_ATTRIBUTE = 'data-cora-chart-mark';
const MARK_VALUE_ATTRIBUTE = 'data-cora-chart-value';
const TOOLTIP_CLASS = 'cora-chart-tooltip';
const TOOLTIP_GAP = 8;
const VIEWPORT_GUTTER = 8;

let nextTooltipId = 0;

/**
 * @typedef {Object} GroupedBarChartTooltipController
 * @property {() => void} refresh
 * @property {() => void} dispose
 */

/** @param {any} target @param {any} svg @returns {any|null} */
function markFromTarget(target, svg) {
  if (!target || typeof target.closest !== 'function') return null;
  const mark = target.closest(MARK_SELECTOR);
  return mark && svg.contains(mark) ? mark : null;
}

/** @param {any} mark @param {any} svg @returns {boolean} */
function isLiveMark(mark, svg) {
  return Boolean(
    mark && mark.getAttribute?.(MARK_ATTRIBUTE) === 'true' && svg.contains(mark)
  );
}

/** @param {any} mark @returns {string|null} */
function markDescription(mark) {
  const value = mark?.getAttribute?.(MARK_VALUE_ATTRIBUTE);
  return value === null || value === undefined ? null : String(value);
}

/** @param {any} mark @param {string} id */
function ownDescription(mark, id) {
  const previous = mark.getAttribute('aria-describedby');
  const ids = previous ? previous.split(/\s+/).filter(Boolean) : [];
  if (!ids.includes(id)) ids.push(id);
  mark.setAttribute('aria-describedby', ids.join(' '));
  return previous;
}

/** @param {any} mark @param {string|null} previous */
function restoreDescription(mark, previous) {
  if (previous === null) mark.removeAttribute('aria-describedby');
  else mark.setAttribute('aria-describedby', previous);
}

/** @param {any} view @param {any} documentObject @param {any} host */
function viewportSize(view, documentObject, host) {
  const documentElement = documentObject?.documentElement;
  return {
    width:
      Number(view?.innerWidth) ||
      Number(documentElement?.clientWidth) ||
      Number(host?.clientWidth) ||
      0,
    height:
      Number(view?.innerHeight) ||
      Number(documentElement?.clientHeight) ||
      Number(host?.clientHeight) ||
      0,
  };
}

/**
 * Mount the delegated HTML tooltip used by a grouped bar chart.
 *
 * @param {SVGSVGElement} svg
 * @param {{ host: Element, document?: Document, view?: Window }} options
 * @returns {GroupedBarChartTooltipController}
 */
export function mountGroupedBarChartTooltip(svg, options) {
  if (!svg || typeof svg.addEventListener !== 'function') {
    throw new TypeError('mountGroupedBarChartTooltip expects an SVG element');
  }
  if (!options?.host || typeof options.host.appendChild !== 'function') {
    throw new TypeError('mountGroupedBarChartTooltip expects a host element');
  }

  const documentObject = options.document ?? globalThis.document;
  const view = options.view ?? globalThis.window;
  const host = options.host;
  const tooltip = documentObject.createElement('div');
  const tooltipId = `cora-chart-tooltip-${++nextTooltipId}`;
  tooltip.className = TOOLTIP_CLASS;
  tooltip.setAttribute('id', tooltipId);
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  host.appendChild(tooltip);

  /** @type {any|null} */
  let hoveredMark = null;
  /** @type {any|null} */
  let focusedMark = null;
  /** @type {any|null} */
  let describedMark = null;
  /** @type {string|null} */
  let describedMarkPreviousValue = null;
  let dismissed = false;
  let disposed = false;
  let keyListenerActive = false;

  /** @param {boolean} active */
  function setKeyListener(active) {
    if (active === keyListenerActive) return;
    if (active) documentObject?.addEventListener?.('keydown', keyDown);
    else documentObject?.removeEventListener?.('keydown', keyDown);
    keyListenerActive = active;
  }

  function releaseDescription() {
    if (!describedMark) return;
    restoreDescription(describedMark, describedMarkPreviousValue);
    describedMark = null;
    describedMarkPreviousValue = null;
  }

  function hide() {
    releaseDescription();
    setKeyListener(false);
    tooltip.hidden = true;
  }

  /** @param {any} mark */
  function choose(mark) {
    if (describedMark === mark) return;
    releaseDescription();
    describedMark = mark;
    describedMarkPreviousValue = ownDescription(mark, tooltipId);
  }

  function refresh() {
    if (disposed) return;

    if (!isLiveMark(hoveredMark, svg)) hoveredMark = null;
    if (!isLiveMark(focusedMark, svg)) focusedMark = null;

    const mark = dismissed ? null : (focusedMark ?? hoveredMark);
    const description = markDescription(mark);
    if (!mark || description === null) {
      hide();
      return;
    }

    choose(mark);
    tooltip.textContent = description;
    tooltip.hidden = false;
    setKeyListener(true);

    const markRect = mark.getBoundingClientRect?.();
    const tooltipRect = tooltip.getBoundingClientRect?.();
    if (!markRect || !tooltipRect) return;

    const { width: viewportWidth, height: viewportHeight } = viewportSize(
      view,
      documentObject,
      host
    );
    const tooltipWidth =
      Number(tooltipRect.width) || Number(tooltip.offsetWidth) || 0;
    const tooltipHeight =
      Number(tooltipRect.height) || Number(tooltip.offsetHeight) || 0;
    const centeredLeft =
      Number(markRect.left) +
      (Number(markRect.width) || 0) / 2 -
      tooltipWidth / 2;
    const maxLeft = Math.max(
      VIEWPORT_GUTTER,
      viewportWidth - tooltipWidth - VIEWPORT_GUTTER
    );
    const left = Math.min(Math.max(centeredLeft, VIEWPORT_GUTTER), maxLeft);
    const aboveTop = Number(markRect.top) - tooltipHeight - TOOLTIP_GAP;
    let top =
      aboveTop >= VIEWPORT_GUTTER
        ? aboveTop
        : Number(markRect.bottom) + TOOLTIP_GAP;
    if (viewportHeight > 0) {
      top = Math.min(
        Math.max(top, VIEWPORT_GUTTER),
        Math.max(
          VIEWPORT_GUTTER,
          viewportHeight - tooltipHeight - VIEWPORT_GUTTER
        )
      );
    }
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  /** @param {any} event */
  function pointerOver(event) {
    const mark = markFromTarget(event.target, svg);
    if (!mark) return;
    hoveredMark = mark;
    dismissed = false;
    refresh();
  }

  /** @param {any} event */
  function pointerOut(event) {
    const mark = markFromTarget(event.target, svg);
    if (!mark || mark.contains(event.relatedTarget)) return;
    if (hoveredMark === mark) hoveredMark = null;
    refresh();
  }

  /** @param {any} event */
  function focusIn(event) {
    const mark = markFromTarget(event.target, svg);
    if (!mark) return;
    focusedMark = mark;
    dismissed = false;
    refresh();
  }

  /** @param {any} event */
  function focusOut(event) {
    const mark = markFromTarget(event.target, svg);
    if (!mark || mark.contains(event.relatedTarget)) return;
    if (focusedMark === mark) focusedMark = null;
    refresh();
  }

  /** @param {KeyboardEvent} event */
  function keyDown(event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    if (!describedMark && !focusedMark && !hoveredMark) return;
    dismissed = true;
    event.preventDefault();
    hide();
  }

  svg.addEventListener('pointerover', pointerOver);
  svg.addEventListener('pointerout', pointerOut);
  svg.addEventListener('focusin', focusIn);
  svg.addEventListener('focusout', focusOut);
  view?.addEventListener?.('resize', refresh);
  documentObject?.addEventListener?.('scroll', refresh, true);

  const controller = {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      svg.removeEventListener('pointerover', pointerOver);
      svg.removeEventListener('pointerout', pointerOut);
      svg.removeEventListener('focusin', focusIn);
      svg.removeEventListener('focusout', focusOut);
      view?.removeEventListener?.('resize', refresh);
      documentObject?.removeEventListener?.('scroll', refresh, true);
      setKeyListener(false);
      releaseDescription();
      if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
    },
  };
  return controller;
}
