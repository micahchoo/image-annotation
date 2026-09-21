import type { App } from 'obsidian';
export interface Point { x: number; y: number }
export type Geometry = { type: 'rect'; x: number; y: number; width: number; height: number } | { type: 'polygon'; points: Point[] };
export interface MediaSource { path: string; originalUrl?: string; articlePath?: string; articleLine?: number; width: number; height: number }
export interface Region { id: string; title: string; source: MediaSource; geometry: Geometry; created: string }
export interface Connection { id: string; regionId: string; notePath: string; blockId?: string; captionPath: string; created: string }
export interface RegionData { version: 1; regions: Region[]; connections: Connection[] }
export interface PassageTarget { notePath: string; blockId?: string }
export interface ReferenceSpec { connectionId: string; mode: 'inline' | 'compact' }
/**
 * Every image path the regions use, frozen, from the store. Media cleanup may
 * hold one across a whole operation and read it once: the store hands over a
 * new object when the regions change and the same one until then. A Region
 * array is never held that way, because its caller may mutate it.
 */
export interface PathSnapshot { readonly paths: readonly string[] }
export interface PluginHost {
 app: App;
 getRegion(id: string): Region | undefined;
 getConnection(id: string): Connection | undefined;
 getConnections(regionId: string): Connection[];
 resourceUrl(source: MediaSource): string;
 readCaption(connection: Connection): Promise<string>;
 openRegion(regionId: string): void;
 openTarget(connection: Connection): Promise<void>;
 openArticle(region: Region): Promise<void>;
 editCaption(connection: Connection): void;
}
export interface RegionEditorOptions {
 source: MediaSource;
 imageUrl: string;
 regions: Region[];
 selectedId?: string;
 onCreate(geometry: Geometry, title: string): Promise<Region>;
 onSelect(region: Region): void;
 onAttach(region: Region): void;
 onUpdate?(region: Region, geometry: Geometry, title: string): Promise<Region>;
 onDelete?(region: Region): Promise<void>;
 onOpenArticle?: () => void;
}
export interface RegionEditorHandle { destroy(): void; select(id: string): void }
