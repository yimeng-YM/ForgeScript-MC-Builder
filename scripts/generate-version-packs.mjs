import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import minecraftData from "minecraft-data";

const targets = [
  "1.12.2",
  "1.13.2",
  "1.16.5",
  "1.18.2",
  "1.19.2",
  "1.19.4",
  "1.20.1",
  "1.20.4",
  "1.20.6",
  "1.21.1",
  "1.21.4",
  "1.21.8",
  "1.21.10",
  "1.21.11",
];

const outputDir = path.resolve("public/version-packs");
const shapeOutputDir = path.resolve("public/shape-packs");
await mkdir(outputDir, { recursive: true });
await mkdir(shapeOutputDir, { recursive: true });

const resourcePackFormats = {
  "1.12.2": 3,
  "1.13.2": 4,
  "1.16.5": 6,
  "1.18.2": 8,
  "1.19.2": 9,
  "1.19.4": 13,
  "1.20.1": 15,
  "1.20.4": 22,
  "1.20.6": 32,
  "1.21.1": 34,
  "1.21.4": 46,
  "1.21.8": 64,
  "1.21.10": 69,
  "1.21.11": 75,
};

const catalog = [];

for (const version of targets) {
  const data = minecraftData(version);
  if (!data?.blocksArray || !data.version?.dataVersion) {
    throw new Error(`minecraft-data is missing the ${version} block registry`);
  }

  const blocks = data.blocksArray.map((entry) => ({
    id: `minecraft:${entry.name}`,
    displayName: entry.displayName,
    defaultStateId: entry.defaultState,
    minStateId: entry.minStateId,
    maxStateId: entry.maxStateId,
    transparent: Boolean(entry.transparent),
    emitLight: entry.emitLight ?? 0,
    properties: (entry.states ?? []).map((state) => ({
      name: state.name,
      values:
        state.values?.map(String) ??
        (state.type === "bool"
          ? ["false", "true"]
          : Array.from({ length: state.num_values ?? 0 }, (_, index) =>
              String(index),
            )),
      stateIdValues:
        state.values?.map(String) ??
        (state.type === "bool"
          ? ["true", "false"]
          : Array.from({ length: state.num_values ?? 0 }, (_, index) => String(index))),
    })),
  }));

  const pack = {
    format: 1,
    gameVersion: version,
    dataVersion: data.version.dataVersion,
    protocolVersion: data.version.version,
    resourcePackFormat: resourcePackFormats[version] ?? null,
    generatedFrom: `minecraft-data@${minecraftData.version ?? "current"}`,
    blockCount: blocks.length,
    blocks,
  };

  const encoded = `${JSON.stringify(pack)}\n`;
  await writeFile(path.join(outputDir, `${version}.json`), encoded, "utf8");
  const shapePack = {
    format: 1,
    gameVersion: version,
    blocks: data.blockCollisionShapes?.blocks ?? {},
    shapes: data.blockCollisionShapes?.shapes ?? {},
  };
  await writeFile(
    path.join(shapeOutputDir, `${version}.json`),
    `${JSON.stringify(shapePack)}\n`,
    "utf8",
  );
  catalog.push({
    id: version,
    dataVersion: pack.dataVersion,
    protocolVersion: pack.protocolVersion,
    blockCount: pack.blockCount,
    bytes: Buffer.byteLength(encoded),
  });
}

for (const version of ["26.1.2", "26.2"]) {
  catalog.push({
    id: version,
    dataVersion: null,
    protocolVersion: null,
    blockCount: 0,
    bytes: 0,
    experimental: true,
  });
}

await writeFile(
  path.join(outputDir, "catalog.json"),
  `${JSON.stringify({ format: 1, versions: catalog }, null, 2)}\n`,
  "utf8",
);

console.log(
  `Generated ${targets.length} version packs with ${catalog.reduce((sum, item) => sum + item.blockCount, 0)} block definitions.`,
);
