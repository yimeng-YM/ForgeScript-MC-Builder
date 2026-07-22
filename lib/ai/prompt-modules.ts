/**
 * Prompt knowledge modules for on-demand loading.
 *
 * Core API docs are always included via builderInstructions().
 * Specialised modules (music, block-states, redstone circuits) are injected
 * only when the user's message or current source indicates that domain.
 */

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

export type KnowledgeModule = "block-states" | "redstone-circuits";

const BLOCK_STATE_KEYWORDS = /墙|栅栏|门|楼梯|台阶|活板门|告示牌|压力板|按钮|漏斗|火把|灯笼|篝火|铁砧|砂轮|切石机|酿造台|炼药锅|wall|fence|door|stair|slab|trapdoor|sign|button|pressure_plate|hopper|lantern|anvil|grindstone|stonecutter|brewing|cauldron/i;

const REDSTONE_CIRCUIT_KEYWORDS = /中继器|比较器|活塞|侦测器|红石火把|红石灯|发射器|投掷器|红石线|红石电路|红石逻辑|repeater|comparator|piston|observer|redstone.?torch|redstone.?lamp|dispenser|dropper|redstone.?wire|redstone.?circuit|clock|时钟|脉冲|信号/i;

export type ModuleSettings = {
  redstoneCircuitModule?: "auto" | "on" | "off";
};

/**
 * Detect which knowledge modules to inject.
 * - "auto": keyword detection from user message + current source
 * - "on": always include
 * - "off": never include
 * Block-state module is always included (core knowledge).
 */
export function detectModules(
  userMessage: string,
  currentSource?: string,
  settings?: ModuleSettings,
): KnowledgeModule[] {
  const text = userMessage + "\n" + (currentSource ?? "");
  const modules: KnowledgeModule[] = ["block-states"]; // always include

  const rcMode = settings?.redstoneCircuitModule ?? "auto";
  if (rcMode === "on" || (rcMode === "auto" && REDSTONE_CIRCUIT_KEYWORDS.test(text))) {
    modules.push("redstone-circuits");
  }

  return modules;
}

// ---------------------------------------------------------------------------
// Module content
// ---------------------------------------------------------------------------

export const BLOCK_STATES_MODULE = `
### 方块属性补充规则
- 墙类方块：连接属性 none/low/tall，不是 true/false；需要 up 和 waterlogged
- 栅栏/玻璃板：四方向连接 none/side/up + waterlogged
- 楼梯：facing/half/shape/waterlogged（shape 自动由引擎推导，可省略）
- 台阶：type top/bottom/double + waterlogged
- 门：facing/half(upper|lower)/hinge(open|left)/open/powered
- 活板门：facing/half(open|bottom)/open/powered/waterlogged
- 按钮：face(floor|wall|ceiling)/facing/powered
- 压力板：powered
- 杠杆：face/facing/powered
- 红石线：四方向 none/side/up + power 0-15（字符串）
- 中继器：facing/delay 1-4/locked/powered
- 比较器：facing/mode(compare|subtract)/powered
- 红石火把：lit
- 红石灯：lit
- 侦测器：facing/powered
- 活塞/粘性活塞：facing/extended
- 漏斗：facing/enabled
- 音符盒：instrument/note 0-24/powered（note 必须是字符串）
- 告示牌：rotation 0-15/waterlogged
- 墙上告示牌：facing/waterlogged
`.trim();

export const REDSTONE_CIRCUITS_MODULE = `
### 红石电路补充知识
- 中继器 facing 从输出指向输入（与信号传播方向相反）；使用 redstone.repeater(signalDirection, options) 避免混淆
- 比较器同理：redstone.comparator(signalDirection, options)
- 红石信号强度 0-15，每经过一格红石粉衰减 1
- 中继器刷新信号强度到 15，延迟 1-4 tick
- 红石火把翻转信号（NOT 门），延迟 1 tick
- 比较器延迟 1 tick，支持比较模式和减法模式
- 信号不能反向穿过中继器/比较器（单向阀效果）
- 活塞推动方块上限 12 个，粘性活塞拉回 1 个
- 侦测器检测前方方块变化，输出 1 tick 脉冲
- 红石火把在连续快速切换时可能烧毁（burn-out），每 game tick 前 8 次切换后烧毁
`.trim();

// ---------------------------------------------------------------------------
// Module assembly
// ---------------------------------------------------------------------------

/**
 * Build the extra knowledge sections for the system prompt.
 * Returns empty string when no specialised modules are needed.
 */
export function buildKnowledgeModules(modules: KnowledgeModule[]): string {
  if (modules.length === 0) return "";
  const parts: string[] = [];
  parts.push("\n## 专项知识（根据当前任务自动加载）");
  for (const mod of modules) {
    switch (mod) {
      case "block-states":
        parts.push(BLOCK_STATES_MODULE);
        break;
      case "redstone-circuits":
        parts.push(REDSTONE_CIRCUITS_MODULE);
        break;
    }
  }
  return parts.join("\n\n");
}
