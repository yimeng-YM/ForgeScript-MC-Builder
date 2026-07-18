const quote = (value: string) => JSON.stringify(value);

export function emptySource(version: string) {
  return `mc.build({
  name: "空白项目",
  version: ${quote(version)},
  author: "LLM MC Builder",
  description: "等待通过对话或源码生成结构"
}, () => {
  // 从空白结构开始；在这里添加方块或通过左侧对话生成。
});`;
}

function redstoneSource(version: string) {
  return `mc.build({
  name: "可调延迟红石脉冲链",
  version: ${quote(version)},
  author: "LLM MC Builder",
  description: "显式保存朝向、延迟与供电状态的演示结构"
}, ({ world, block, redstone }) => {
  const main = world.region("main", { origin: [0, 0, 0] });
  const base = block("minecraft:smooth_stone");
  const dust = redstone.wire(0);

  main.fill([0, 0, 0], [12, 0, 4], base);
  main.set([1, 1, 2], block("minecraft:lever", { face: "floor", facing: "east", powered: "false" }));
  main.set([2, 1, 2], dust);
  main.set([3, 1, 2], redstone.repeater("east", { delay: 2 }));
  main.line([4, 1, 2], [6, 1, 2], dust);
  main.set([7, 1, 2], redstone.comparator("east", { mode: "compare" }));
  main.line([8, 1, 2], [10, 1, 2], dust);
  main.set([11, 1, 2], block("minecraft:redstone_lamp", { lit: "false" }));
});`;
}

function towerSource(version: string) {
  return `mc.build({
  name: "铜顶瞭望塔",
  version: ${quote(version)},
  author: "LLM MC Builder",
  description: "带螺旋窗与铜制屋顶的小型塔楼"
}, ({ world, block }) => {
  const main = world.region("tower", { origin: [0, 0, 0] });
  const stone = block("minecraft:stone_bricks");
  const dark = block("minecraft:deepslate_bricks");
  const glass = block("minecraft:light_blue_stained_glass");
  const copper = block("minecraft:oxidized_cut_copper");

  main.fill([0, 0, 0], [10, 0, 10], dark);
  main.walls([1, 1, 1], [9, 12, 9], stone);
  main.fill([1, 12, 1], [9, 12, 9], dark);
  for (let y = 3; y <= 10; y += 3) {
    main.set([5, y, 1], glass);
    main.set([9, y, 5], glass);
    main.set([5, y, 9], glass);
    main.set([1, y, 5], glass);
  }
  for (let inset = 0; inset < 5; inset++) {
    main.fill([inset, 13 + inset, inset], [10 - inset, 13 + inset, 10 - inset], copper);
  }
  main.fill([4, 1, 1], [6, 3, 1], block("minecraft:air"));
  main.set([5, 1, 1], block("minecraft:oak_door", { facing: "north", half: "lower", hinge: "left", open: "false", powered: "false" }));
  main.set([5, 2, 1], block("minecraft:oak_door", { facing: "north", half: "upper", hinge: "left", open: "false", powered: "false" }));
});`;
}

function houseSource(version: string) {
  return `mc.build({
  name: "云杉工匠小屋",
  version: ${quote(version)},
  author: "LLM MC Builder",
  description: "使用参数化墙体、梁柱和分层屋顶生成"
}, ({ world, block }) => {
  const main = world.region("house", { origin: [0, 0, 0] });
  const foundation = block("minecraft:cobblestone");
  const wall = block("minecraft:spruce_planks");
  const beam = block("minecraft:stripped_spruce_log", { axis: "y" });
  const glass = block("minecraft:glass_pane", { north: "false", east: "true", south: "false", west: "true", waterlogged: "false" });
  const roof = block("minecraft:dark_oak_planks");

  main.fill([0, 0, 0], [12, 0, 9], foundation);
  main.walls([1, 1, 1], [11, 5, 8], wall);
  for (const x of [1, 6, 11]) for (const z of [1, 8]) main.pillar([x, 1, z], 6, beam);
  main.fill([5, 1, 1], [6, 3, 1], block("minecraft:air"));
  main.set([3, 3, 1], glass);
  main.set([9, 3, 1], glass);
  main.set([3, 3, 8], glass);
  main.set([9, 3, 8], glass);
  for (let layer = 0; layer < 4; layer++) {
    main.fill([-layer, 6 + layer, layer], [12 + layer, 6 + layer, 9 - layer], roof);
  }
  main.set([5, 1, 1], block("minecraft:oak_door", { facing: "north", half: "lower", hinge: "left", open: "false", powered: "false" }));
  main.set([5, 2, 1], block("minecraft:oak_door", { facing: "north", half: "upper", hinge: "left", open: "false", powered: "false" }));
});`;
}

export function sourceForPrompt(prompt: string, version: string): string {
  const normalized = prompt.toLowerCase();
  if (/红石|repeater|comparator|脉冲|延迟|电路/.test(normalized)) return redstoneSource(version);
  if (/塔|tower|瞭望|高塔/.test(normalized)) return towerSource(version);
  return houseSource(version);
}

export const DEFAULT_SOURCE = emptySource("1.21.11");
