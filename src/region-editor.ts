import type { Geometry, Point, Region, RegionEditorHandle, RegionEditorOptions } from './types';
import { geometryIsUsable, geometryToSvgPoints, normalizePoint, normalizePolygon, normalizeRect } from './geometry';

const SVG_NS = 'http://www.w3.org/2000/svg';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = createEl(tag);
  if (className) node.className = className;
  return node;
}

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

export function mountRegionEditor(container: HTMLElement, options: RegionEditorOptions): RegionEditorHandle {
  const root = element('section', 'region-editor');
  root.setAttribute('aria-label', 'Region editor');
  container.append(root);

  const toolbar = element('div', 'region-editor__toolbar');
  const selectButton = element('button', 'region-editor__tool region-editor__tool--select');
  selectButton.type = 'button'; selectButton.textContent = 'Select';
  const replaceButton = element('button', 'region-editor__replace');
  replaceButton.type = 'button'; replaceButton.textContent = 'Edit region'; replaceButton.disabled = true;
  const deleteButton = element('button', 'region-editor__delete');
  deleteButton.type = 'button'; deleteButton.textContent = 'Delete region'; deleteButton.disabled = true;
  const rectButton = element('button', 'region-editor__tool region-editor__tool--rect');
  rectButton.type = 'button'; rectButton.textContent = 'Draw rectangle';
  const polygonButton = element('button', 'region-editor__tool region-editor__tool--polygon');
  polygonButton.type = 'button'; polygonButton.textContent = 'Draw polygon';
  const finishButton = element('button', 'region-editor__finish');
  finishButton.type = 'button'; finishButton.textContent = 'Finish polygon'; finishButton.hidden = true;
  const cancelButton = element('button', 'region-editor__cancel');
  cancelButton.type = 'button'; cancelButton.textContent = 'Cancel';
  const saveButton = element('button', 'region-editor__save');
  saveButton.type = 'button'; saveButton.textContent = 'Save region'; saveButton.disabled = true;
  const zoomOutButton = element('button', 'region-editor__zoom-out');
  zoomOutButton.type = 'button'; zoomOutButton.textContent = 'Zoom out';
  const zoomInButton = element('button', 'region-editor__zoom-in');
  zoomInButton.type = 'button'; zoomInButton.textContent = 'Zoom in';
  const fitButton = element('button', 'region-editor__zoom-fit');
  fitButton.type = 'button'; fitButton.textContent = 'Fit image';
  toolbar.append(selectButton, replaceButton, rectButton, polygonButton, finishButton, saveButton, cancelButton, deleteButton, zoomOutButton, zoomInButton, fitButton);

  const titleLabel = element('label', 'region-editor__title-label');
  titleLabel.textContent = 'Region title';
  const titleInput = element('input', 'region-editor__title');
  titleInput.type = 'text'; titleInput.placeholder = 'Describe this region'; titleInput.autocomplete = 'off';
  titleLabel.append(titleInput);

  const sourceButton = element('button', 'region-editor__source');
  sourceButton.type = 'button'; sourceButton.textContent = 'Open source note';
  sourceButton.hidden = !options.onOpenArticle;
  const attachButton = element('button', 'region-editor__attach');
  attachButton.type = 'button'; attachButton.textContent = 'Attach to note'; attachButton.disabled = true;
  toolbar.append(titleLabel, sourceButton, attachButton);

  const status = element('div', 'region-editor__status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const body = element('div', 'region-editor__body');
  const viewport = element('div', 'region-editor__viewport');
  const stage = element('div', 'region-editor__stage');
  const image = element('img', 'region-editor__image');
  image.width = options.source.width; image.height = options.source.height;
  image.src = options.imageUrl; image.alt = options.source.path;
  const svg = svgElement('svg');
  svg.classList.add('region-editor__overlay'); svg.setAttribute('viewBox', '0 0 1 1');
  svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Image regions');
  stage.append(image, svg);
  const list = element('div', 'region-editor__list');
  list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Existing regions');
  viewport.append(stage); body.append(viewport, list); root.append(toolbar, status, body);

  type Mode = 'select' | 'rect' | 'polygon';
  let mode: Mode = 'select';
  const regions = [...options.regions];
  let selectedId = options.selectedId;
  let drawingStart: Point | undefined;
  let drawingShape: SVGElement | undefined;
  let polygonPoints: Point[] = [];
  let draftGeometry: Geometry | undefined;
  let editingRegion: Region | undefined;
  let deleteConfirm = false;
  let saving = false;
  let zoom = 1;
  let destroyed = false;
  const cleanups: Array<() => void> = [];

  const listen = (target: EventTarget, event: string, handler: EventListener, opts?: AddEventListenerOptions) => {
    target.addEventListener(event, handler, opts); cleanups.push(() => target.removeEventListener(event, handler, opts));
  };
  const setStatus = (message: string) => { if (!destroyed) status.textContent = message; };
  const pointFromEvent = (event: PointerEvent | MouseEvent): Point => {
    const bounds = svg.getBoundingClientRect();
    return normalizePoint({ x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height });
  };
  const focusSelected = () => {
    for (const button of list.querySelectorAll<HTMLElement>('[data-region-id]')) {
      if (button.dataset.regionId === selectedId) { button.focus(); break; }
    }
  };
  const setSelected = (region: Region | undefined, notify: boolean) => {
    selectedId = region?.id;
    attachButton.disabled = !region;
    replaceButton.disabled = !region || !options.onUpdate;
    deleteButton.disabled = !region || !options.onDelete;
    deleteConfirm = false;
    deleteButton.textContent = 'Delete region';
    if (region && !editingRegion) titleInput.value = region.title;
    for (const node of svg.querySelectorAll<SVGElement>('[data-region-id]')) node.classList.toggle('is-selected', node.dataset.regionId === selectedId);
    for (const node of list.querySelectorAll<HTMLElement>('[data-region-id]')) {
      const isSelected = node.dataset.regionId === selectedId;
      node.setAttribute('aria-selected', String(isSelected)); node.classList.toggle('is-selected', isSelected);
    }
    if (region && notify) options.onSelect(region);
    if (region && notify) {
      const g = region.geometry;
      const x = g.type === 'rect' ? g.x : Math.min(...g.points.map(p => p.x));
      const y = g.type === 'rect' ? g.y : Math.min(...g.points.map(p => p.y));
      const w = g.type === 'rect' ? g.width : Math.max(...g.points.map(p => p.x)) - x;
      const h = g.type === 'rect' ? g.height : Math.max(...g.points.map(p => p.y)) - y;
      const baseHeight = viewport.clientWidth * options.source.height / options.source.width;
      setZoom(Math.min(.8 / w, .8 * (viewport.clientHeight || baseHeight) / (baseHeight * h)));
      viewport.scrollTo({left:(x+w/2)*stage.clientWidth-viewport.clientWidth/2,top:(y+h/2)*stage.clientHeight-viewport.clientHeight/2});
    }
  };
  const renderRegion = (region: Region) => {
    const shape = region.geometry.type === 'rect' ? svgElement('rect') : svgElement('polygon');
    shape.classList.add('region-editor__region'); shape.dataset.regionId = region.id;
    shape.setAttribute('aria-label', region.title || `Region ${region.id}`);
    if (region.geometry.type === 'rect') {
      shape.setAttribute('x', String(region.geometry.x)); shape.setAttribute('y', String(region.geometry.y)); shape.setAttribute('width', String(region.geometry.width)); shape.setAttribute('height', String(region.geometry.height));
    } else shape.setAttribute('points', geometryToSvgPoints(region.geometry.points));
    const choose = () => { if(mode !== 'select')return; if (editingRegion && editingRegion.id !== region.id) { editingRegion = undefined; resetDrawing(); } setSelected(region, true); };
    listen(shape, 'click', choose); listen(shape, 'keydown', ((event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } }) as EventListener);
    svg.append(shape);
  };
  const removeRegionShape = (id: string) => {
    const shape = Array.from(svg.querySelectorAll<SVGElement>('[data-region-id]')).find((node) => node.dataset.regionId === id);
    shape?.remove();
  };
  const renderList = () => {
    list.replaceChildren();
    for (const region of regions) {
      const item = element('button', 'region-editor__region-item'); item.type = 'button'; item.dataset.regionId = region.id; item.textContent = region.title || 'Untitled region'; item.setAttribute('role', 'option');
      item.addEventListener('click', () => { if (editingRegion && editingRegion.id !== region.id) { editingRegion = undefined; resetDrawing(); } setSelected(region, true); });
      list.append(item);
    }
    setSelected(regions.find((region) => region.id === selectedId), Boolean(selectedId));
  };
  const resetDrawing = () => { drawingStart = undefined; polygonPoints = []; draftGeometry = undefined; drawingShape?.remove(); drawingShape = undefined; finishButton.hidden = true; saveButton.disabled = !editingRegion; };
  const setZoom = (next: number) => { zoom = Math.max(1, Math.min(4, next)); stage.style.width = `${zoom * 100}%`; setStatus(zoom === 1 ? 'Full image shown.' : `Zoom ${Math.round(zoom * 100)}%.`); };
  const submit = async (geometry: Geometry) => {
    if (saving) return;
    if (!geometryIsUsable(geometry)) { setStatus('The region is too small or does not have enough points.'); return; }
    const title = titleInput.value.trim();
    if (!title) { setStatus('Enter a title before saving the region.'); titleInput.focus(); return; }
    saving = true; saveButton.disabled = true; titleInput.disabled = true; setStatus('Saving region…');
    try {
      const region = await options.onCreate(geometry, title);
      if (destroyed) return;
      regions.push(region); titleInput.value = ''; resetDrawing(); renderRegion(region); renderList(); setSelected(region, true); setStatus(`Created ${region.title || 'region'}.`);
    } catch (error) { saveButton.disabled = !draftGeometry; setStatus(error instanceof Error ? `Could not create region: ${error.message}` : 'Could not create region.'); }
    finally { saving = false; titleInput.disabled = false; }
  };
  const updateSelected = async () => {
    if (!editingRegion || !options.onUpdate || saving) return;
    const geometry = draftGeometry ?? editingRegion.geometry;
    const title = titleInput.value.trim();
    if (!title) { setStatus('Enter a title before saving changes.'); titleInput.focus(); return; }
    if (!geometryIsUsable(geometry)) { setStatus('The region is too small or does not have enough points.'); return; }
    saving = true; saveButton.disabled = true; titleInput.disabled = true; setStatus('Saving region changes…');
    try {
      const updated = await options.onUpdate(editingRegion, geometry, title);
      if (destroyed) return;
      const index = regions.findIndex((region) => region.id === updated.id);
      if (index >= 0) regions[index] = updated;
      removeRegionShape(editingRegion.id);
      editingRegion = undefined; resetDrawing(); renderRegion(updated); renderList(); setSelected(updated, true); setStatus(`Saved ${updated.title || 'region'}.`);
    } catch (error) { saveButton.disabled = false; setStatus(error instanceof Error ? `Could not save region: ${error.message}` : 'Could not save region.'); }
    finally { saving = false; titleInput.disabled = false; }
  };
  const finishPolygon = () => { if (polygonPoints.length >= 3) { draftGeometry = normalizePolygon(polygonPoints); saveButton.disabled = false; setStatus('Polygon ready. Add a title and save the region.'); } else setStatus('Add at least three polygon points.'); };

  listen(root, 'click', ((event: Event) => {if(saving){event.preventDefault();event.stopImmediatePropagation();}}), {capture:true});
  listen(selectButton, 'click', (() => { mode = 'select'; editingRegion = undefined; resetDrawing(); setStatus('Select a region or choose a drawing tool.'); }));
  listen(replaceButton, 'click', (() => { const region = regions.find((candidate) => candidate.id === selectedId); if (!region || !options.onUpdate) return; editingRegion = region; titleInput.value = region.title; mode = 'rect'; resetDrawing(); setStatus('Draw a replacement, or save to rename this region.'); }));
  listen(rectButton, 'click', (() => { mode = 'rect'; resetDrawing(); setStatus('Drag on the image to draw a rectangle.'); }));
  listen(polygonButton, 'click', (() => { mode = 'polygon'; resetDrawing(); finishButton.hidden = false; setStatus('Click points on the image, then finish the polygon.'); }));
  listen(finishButton, 'click', finishPolygon);
  listen(saveButton, 'click', (() => { if (editingRegion) void updateSelected(); else if (draftGeometry) void submit(draftGeometry); }));
  listen(cancelButton, 'click', (() => { editingRegion = undefined; resetDrawing(); setStatus('Drawing cancelled.'); }));
  listen(sourceButton, 'click', (() => { if (options.onOpenArticle) { try { void Promise.resolve(options.onOpenArticle()).catch((error) => setStatus(error instanceof Error ? `Could not open source note: ${error.message}` : 'Could not open source note.')); } catch (error) { setStatus(error instanceof Error ? `Could not open source note: ${error.message}` : 'Could not open source note.'); } } }));
  listen(attachButton, 'click', (() => { const region = regions.find((candidate) => candidate.id === selectedId); if (region) options.onAttach(region); }));
  listen(deleteButton, 'click', (() => {
    const region = regions.find((candidate) => candidate.id === selectedId);
    if (!region || !options.onDelete || saving) return;
    if (!deleteConfirm) { deleteConfirm = true; deleteButton.textContent = `Confirm delete “${region.title || 'region'}”`; setStatus('Click delete again to confirm.'); return; }
    saving = true; deleteButton.disabled = true; titleInput.disabled = true; setStatus('Deleting region…');
    void Promise.resolve().then(() => options.onDelete!(region)).then(() => {
      if (destroyed) return;
      const index = regions.findIndex((candidate) => candidate.id === region.id); if (index >= 0) regions.splice(index, 1);
      removeRegionShape(region.id); editingRegion = undefined; selectedId = undefined; titleInput.value = ''; renderList(); setStatus('Region deleted.');
    }).catch((error) => { deleteButton.disabled = false; deleteConfirm = false; deleteButton.textContent = 'Delete region'; setStatus(error instanceof Error ? `Could not delete region: ${error.message}` : 'Could not delete region.'); }).finally(() => { saving = false; titleInput.disabled = false; });
  }));
  listen(zoomOutButton, 'click', (() => setZoom(zoom - 0.5)));
  listen(zoomInButton, 'click', (() => setZoom(zoom + 0.5)));
  listen(fitButton, 'click', (() => setZoom(1)));
  listen(svg, 'pointerdown', ((event: PointerEvent) => {
    if (saving || event.button !== 0) return;
    if (mode === 'select') return;
    if (mode === 'polygon') { polygonPoints.push(pointFromEvent(event)); if (!drawingShape) drawingShape = svgElement('polyline'); drawingShape.classList.add('region-editor__draft'); drawingShape.setAttribute('points', geometryToSvgPoints(polygonPoints)); svg.append(drawingShape); return; }
    drawingStart = pointFromEvent(event); svg.setPointerCapture?.(event.pointerId);
  }) as EventListener);
  listen(svg, 'pointermove', ((event: PointerEvent) => { if (mode === 'rect' && drawingStart) { const geometry = normalizeRect(drawingStart, pointFromEvent(event)); draftGeometry = geometry; saveButton.disabled = false; if (!drawingShape) { drawingShape = svgElement('rect'); drawingShape.classList.add('region-editor__draft'); svg.append(drawingShape); } drawingShape.setAttribute('x', String(geometry.x)); drawingShape.setAttribute('y', String(geometry.y)); drawingShape.setAttribute('width', String(geometry.width)); drawingShape.setAttribute('height', String(geometry.height)); } }) as EventListener);
  listen(svg, 'pointerup', ((event: PointerEvent) => { if (mode === 'rect' && drawingStart) { draftGeometry = normalizeRect(drawingStart, pointFromEvent(event)); saveButton.disabled = false; drawingStart = undefined; setStatus('Rectangle ready. Add a title and save the region.'); } }) as EventListener);
  listen(svg, 'pointercancel', (() => { resetDrawing(); setStatus('Drawing cancelled.'); }));
  listen(root, 'keydown', ((event: KeyboardEvent) => { if (event.key === 'Escape' && !saving && (draftGeometry || drawingStart || polygonPoints.length)) { event.preventDefault(); event.stopPropagation(); editingRegion = undefined; resetDrawing(); setStatus('Drawing cancelled.'); } }) as EventListener);
  listen(image, 'error', (() => setStatus('The image could not be loaded.')));

  for (const region of regions) renderRegion(region);
  renderList();
  if (image.complete && image.naturalWidth === 0) setStatus('The image could not be loaded.');

  return {
    destroy() { if (destroyed) return; destroyed = true; cleanups.splice(0).forEach((cleanup) => cleanup()); root.remove(); },
    select(id: string) { const region = regions.find((candidate) => candidate.id === id); if (!region) return; setSelected(region, true); focusSelected(); },
  };
}
