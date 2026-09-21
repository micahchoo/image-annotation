import { MarkdownRenderer, type Component } from 'obsidian';
import type { Connection, PluginHost, ReferenceSpec, Region } from './types';
export { LANGUAGE, parseReference, referenceMarkdown } from './reference-format';

function textElement(tag: keyof HTMLElementTagNameMap, text: string, className?: string): HTMLElement {
  const element = createEl(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function button(label: string, action: () => void | Promise<void>, onError: (error: unknown) => void): HTMLButtonElement {
  const element = createEl('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', () => void Promise.resolve().then(action).catch(onError));
  return element;
}

function addControls(parent: HTMLElement, host: PluginHost, region: Region, connection: Connection, mode: ReferenceSpec['mode']): void {
  const controls = textElement('div', '', 'region-reference-controls');
  const nextMode = mode === 'inline' ? 'compact' : 'inline';
  const status = textElement('span', '', 'region-reference-control-error');
  const onError = (error: unknown) => {
    status.textContent = error instanceof Error && error.message ? error.message : 'Action could not be completed.';
  };
  controls.append(
    button('Open region', () => host.openRegion(region.id), onError),
    button('Open note', () => host.openTarget(connection), onError),
    button('Source note', () => host.openArticle(region), onError),
    button('Edit caption', () => host.editCaption(connection), onError),
    button(nextMode === 'compact' ? 'Collapse preview' : 'Show image and caption', () => {
      controls.dispatchEvent(new CustomEvent('image-annotation-mode', {
        detail: { mode: nextMode },
        bubbles: true,
      }));
    }, onError),
    status,
  );
  parent.append(controls);
}

function createImage(host: PluginHost, region: Region): SVGSVGElement {
  const source = region.source;
  const geometry = region.geometry;
  const svg = createSvg('svg');
  svg.classList.add('region-reference-image');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', region.title || 'Referenced region');

  let viewX = 0;
  let viewY = 0;
  let viewWidth = source.width;
  let viewHeight = source.height;
  if (geometry.type === 'rect') {
    viewX = geometry.x * source.width;
    viewY = geometry.y * source.height;
    viewWidth = geometry.width * source.width;
    viewHeight = geometry.height * source.height;
  } else if (geometry.points.length > 0) {
    const pixelPoints = geometry.points.map((point) => ({ x: point.x * source.width, y: point.y * source.height }));
    viewX = Math.min(...pixelPoints.map((point) => point.x));
    viewY = Math.min(...pixelPoints.map((point) => point.y));
    viewWidth = Math.max(...pixelPoints.map((point) => point.x)) - viewX;
    viewHeight = Math.max(...pixelPoints.map((point) => point.y)) - viewY;
  }
  viewWidth = Math.max(viewWidth, 0.000001);
  viewHeight = Math.max(viewHeight, 0.000001);
  svg.setAttribute('viewBox', `${viewX} ${viewY} ${viewWidth} ${viewHeight}`);

  let resourceUrl: string;
  try {
    resourceUrl = host.resourceUrl(source);
    if (!resourceUrl) throw new Error('missing');
  } catch {
    throw new Error('Referenced image is unavailable.');
  }
  const image = createSvg('image');
  image.setAttribute('href', resourceUrl);
  image.setAttribute('x', '0');
  image.setAttribute('y', '0');
  image.setAttribute('width', String(source.width));
  image.setAttribute('height', String(source.height));
  image.setAttribute('preserveAspectRatio', 'none');

  if (geometry.type === 'polygon' && geometry.points.length >= 3) {
    const defs = createSvg('defs');
    const clip = createSvg('clipPath');
    const id = `region-reference-clip-${crypto.randomUUID()}`;
    clip.setAttribute('id', id);
    const polygon = createSvg('polygon');
    polygon.setAttribute('points', geometry.points.map((point) => `${point.x * source.width},${point.y * source.height}`).join(' '));
    clip.append(polygon);
    defs.append(clip);
    svg.append(defs);
    image.setAttribute('clip-path', `url(#${id})`);
  }
  svg.append(image);
  return svg;
}

async function renderResolved(host: PluginHost, spec: ReferenceSpec, container: HTMLElement, component: Component): Promise<void> {
  const connection = host.getConnection(spec.connectionId);
  if (!connection) {
    container.append(textElement('span', `Region reference “${spec.connectionId}” is unavailable. Use Remove unavailable references to clean up this preview.`, 'region-reference-fallback'));
    return;
  }
  const region = host.getRegion(connection.regionId);
  if (!region) {
    container.append(textElement('span', `Region “${connection.regionId}” is unavailable. Use Remove unavailable references to clean up this preview.`, 'region-reference-fallback'));
    return;
  }

  const content = textElement('div', '', 'region-reference-content');
  content.append(createImage(host, region));
  const caption = textElement('div', '', 'region-reference-caption');
  content.append(caption);
  try {
    const markdown = await host.readCaption(connection);
    await MarkdownRenderer.render(host.app, markdown, caption, connection.captionPath, component);
  } catch {
    caption.append(textElement('span', 'Caption unavailable.', 'region-reference-fallback'));
  }
  addControls(content, host, region, connection, spec.mode);

  const attribution = textElement('div', '', 'region-reference-attribution');
  attribution.append(textElement('span', `Source: ${region.title || region.source.path}`));
  if (region.source.originalUrl) {
    const link = createEl('a');
    link.href = region.source.originalUrl;
    link.textContent = ' (Original)';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    attribution.append(link);
  }

  if (spec.mode === 'compact') {
    const details = createEl('details');
    details.className = 'region-reference region-reference-compact';
    const summary = textElement('summary', region.title || 'Referenced region');
    details.append(summary, content, attribution);
    container.append(details);
  } else {
    const root = textElement('div', '', 'region-reference region-reference-inline');
    root.append(content, attribution);
    container.append(root);
  }
}

export async function renderReference(host: PluginHost, spec: ReferenceSpec, container: HTMLElement, component: Component): Promise<void> {
  container.replaceChildren();
  try {
    await renderResolved(host, spec, container, component);
  } catch (error) {
    container.replaceChildren(textElement('span', 'Unable to render this region reference.', 'region-reference-fallback'));
    if (error instanceof Error && error.message === 'Referenced image is unavailable.') {
      container.firstElementChild!.textContent = error.message;
    }
  }
}
