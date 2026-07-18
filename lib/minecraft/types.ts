export type BlockProperties = Record<string, string>;

export type BlockState = {
  id: string;
  properties: BlockProperties;
  nbt?: Record<string, unknown>;
};

export type PlacedBlock = {
  region: string;
  x: number;
  y: number;
  z: number;
  state: BlockState;
};

export type WorldDocument = {
  name: string;
  version: string;
  author: string;
  description: string;
  blocks: PlacedBlock[];
};

export type BlockPropertySchema = {
  name: string;
  values: string[];
  /** Values in Minecraft's numeric state-id order. Boolean states are true, false. */
  stateIdValues?: string[];
};

export type BlockDefinition = {
  id: string;
  displayName: string;
  defaultStateId: number;
  minStateId: number;
  maxStateId: number;
  transparent: boolean;
  emitLight: number;
  properties: BlockPropertySchema[];
};

export type VersionPack = {
  format: 1;
  gameVersion: string;
  dataVersion: number;
  protocolVersion: number;
  resourcePackFormat?: number | null;
  generatedFrom: string;
  blockCount: number;
  blocks: BlockDefinition[];
};

export type VersionCatalogEntry = {
  id: string;
  dataVersion: number | null;
  protocolVersion: number | null;
  blockCount: number;
  bytes: number;
  experimental?: boolean;
};

export type Diagnostic = {
  severity: "error" | "warning" | "info";
  stage: "runtime" | "block-state" | "structure" | "redstone" | "export";
  code: string;
  message: string;
  block?: Pick<PlacedBlock, "region" | "x" | "y" | "z">;
  suggestion?: string;
};

export type WorldStats = {
  blockCount: number;
  paletteSize: number;
  volume: number;
  size: [number, number, number];
  materials: Array<{ id: string; count: number }>;
};
