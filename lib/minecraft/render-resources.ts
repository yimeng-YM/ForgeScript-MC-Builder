import {
  BlockDefinition as DeepslateBlockDefinition,
  BlockModel,
  TextureAtlas,
  type Identifier,
  type Resources,
} from "deepslate";
import { defaultBlockProperties } from "./block-shapes";
import { resolveResourcePackAssets, type ResourcePackSummary } from "./resource-packs";
import type { VersionPack } from "./types";

export type LoadedRenderResources = {
  resources: Resources;
  packNames: string[];
  warnings: string[];
  blockDefinitionCount: number;
  blockModelCount: number;
  textureCount: number;
};

const textDecoder = new TextDecoder();

function parseJson(bytes: Uint8Array, path: string, warnings: string[]) {
  try {
    return JSON.parse(textDecoder.decode(bytes)) as unknown;
  } catch (error) {
    warnings.push(`${path} 解析失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function loadRenderResources(
  packs: ResourcePackSummary[],
  targetFormat: number | null,
  versionPack: VersionPack,
): Promise<LoadedRenderResources | null> {
  const resolved = await resolveResourcePackAssets(packs, targetFormat);
  if (resolved.enabledPacks.length === 0) return null;

  const warnings = [...resolved.warnings];
  const blockDefinitions = new Map<string, DeepslateBlockDefinition>();
  const blockModels = new Map<string, BlockModel>();
  const textures: Record<string, Blob> = {};

  for (const [path, bytes] of resolved.files) {
    const blockStateMatch = path.match(/^([^/]+)\/blockstates\/(.+)\.json$/i);
    if (blockStateMatch) {
      const json = parseJson(bytes, path, warnings);
      if (json !== null) {
        try {
          blockDefinitions.set(`${blockStateMatch[1]}:${blockStateMatch[2]}`, DeepslateBlockDefinition.fromJson(json));
        } catch (error) {
          warnings.push(`${path} 无法转换为方块定义：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      continue;
    }

    const modelMatch = path.match(/^([^/]+)\/models\/(.+)\.json$/i);
    if (modelMatch) {
      const json = parseJson(bytes, path, warnings);
      if (json !== null) {
        try {
          blockModels.set(`${modelMatch[1]}:${modelMatch[2]}`, BlockModel.fromJson(json));
        } catch (error) {
          warnings.push(`${path} 无法转换为方块模型：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      continue;
    }

    const textureMatch = path.match(/^([^/]+)\/textures\/(.+)\.png$/i);
    if (textureMatch) {
      textures[`${textureMatch[1]}:${textureMatch[2]}`] = new Blob(
        [new Uint8Array(bytes)],
        { type: "image/png" },
      );
    }
  }

  const provider = {
    getBlockModel(id: Identifier) {
      return blockModels.get(id.toString()) ?? null;
    },
  };
  for (const [id, model] of blockModels) {
    try {
      model.flatten(provider);
    } catch (error) {
      warnings.push(`${id} 的父模型继承解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const atlas = Object.keys(textures).length > 0
    ? await TextureAtlas.fromBlobs(textures)
    : TextureAtlas.empty();
  const definitionsById = new Map(versionPack.blocks.map((definition) => [definition.id, definition]));
  const resources: Resources = {
    getBlockDefinition(id) {
      return blockDefinitions.get(id.toString()) ?? null;
    },
    getBlockModel(id) {
      return blockModels.get(id.toString()) ?? null;
    },
    getTextureAtlas() {
      return atlas.getTextureAtlas();
    },
    getTextureUV(id) {
      return atlas.getTextureUV(id);
    },
    getPixelSize() {
      return atlas.getPixelSize();
    },
    getBlockFlags(id) {
      const definition = definitionsById.get(id.toString());
      if (!definition) return null;
      const name = id.path;
      return {
        opaque: !definition.transparent,
        semi_transparent: /glass|water|ice|portal|slime|honey/.test(name),
        self_culling: /glass|leaves|water|ice/.test(name),
      };
    },
    getBlockProperties(id) {
      const definition = definitionsById.get(id.toString());
      return definition
        ? Object.fromEntries(definition.properties.map((property) => [property.name, property.values]))
        : null;
    },
    getDefaultBlockProperties(id) {
      const definition = definitionsById.get(id.toString());
      return definition ? defaultBlockProperties(definition) : null;
    },
  };

  if (blockDefinitions.size === 0 || blockModels.size === 0) {
    warnings.push("当前启用栈没有完整的 blockstates/models；缺失方块将使用真实碰撞形状和程序化材质");
  }

  return {
    resources,
    packNames: resolved.enabledPacks.map((pack) => pack.name),
    warnings,
    blockDefinitionCount: blockDefinitions.size,
    blockModelCount: blockModels.size,
    textureCount: Object.keys(textures).length,
  };
}
