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

export type KnowledgeModule = "block-states" | "redstone-circuits" | "redstone-music";

const BLOCK_STATE_KEYWORDS = /墙|栅栏|门|楼梯|台阶|活板门|告示牌|压力板|按钮|漏斗|火把|灯笼|篝火|铁砧|砂轮|切石机|酿造台|炼药锅|wall|fence|door|stair|slab|trapdoor|sign|button|pressure_plate|hopper|lantern|anvil|grindstone|stonecutter|brewing|cauldron/i;

const REDSTONE_CIRCUIT_KEYWORDS = /中继器|比较器|活塞|侦测器|红石火把|红石灯|发射器|投掷器|红石线|红石电路|红石逻辑|repeater|comparator|piston|observer|redstone.?torch|redstone.?lamp|dispenser|dropper|redstone.?wire|redstone.?circuit|clock|时钟|脉冲|信号/i;

const REDSTONE_MUSIC_KEYWORDS = /红石音乐|音乐盒|音符盒|音乐|乐谱|乐器|音色|旋律|歌曲|节拍|note.?block|noteblock|music|melody|song/i;

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

  if (REDSTONE_MUSIC_KEYWORDS.test(text)) {
    modules.push("redstone-music");
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

/**
 * Practical rules distilled from the Minecraft Wiki redstone-music tutorial
 * and current Java Edition note-block mechanics.
 * https://zh.minecraft.wiki/w/Tutorial:%E7%BA%A2%E7%9F%B3%E9%9F%B3%E4%B9%90?variant=zh-cn
 */
export const REDSTONE_MUSIC_MODULE = `
### 红石音乐设计流程
1. 先把需求整理成时间轴：明确 BPM、拍号、最小节奏单位、声部、乐器，以及每个事件的开始拍、音高和是否为休止；资料不完整时写明假设，不得随意堆音符盒
2. 把每个声部转换为按绝对时间排序的事件；同一时刻的音符是和弦，必须走累计延迟相同的并行线路，不能串联成琶音
3. 将音名转换为 note 0-24，将音色转换为 instrument ID，再将相邻事件的时间差转换为红石刻
4. 先设计时钟/节拍主干和各声部支路，再放音符盒；最后逐项复核音高、音色、累计延迟、朝向、上升沿和顶部空间

### 节奏与延迟换算
- 1 红石刻（rt）= 2 游戏刻 = 0.1 秒；以下公式假设四分音符为一拍
- BPM 为 x 时：三十二分音符=75/x rt，十六分音符=150/x rt，八分三连音=200/x rt，八分音符=300/x rt，四分音符=600/x rt，二分音符=1200/x rt，附点二分音符=1800/x rt，全音符=2400/x rt
- “音符时值/休止符时值”在音符盒电路中主要表现为本次触发到下一事件的间隔；休止符只增加延迟，不放置会发声的音符盒
- 每个中继器 delay 只能是 1-4 rt。总延迟超过 4 rt 时拆成多个中继器；可用 redstone.delayChain(signalDirection, totalTicks) 得到不超过 4 的延迟段
- 不要逐段独立四舍五入造成整首曲目漂移；先计算事件的理论累计时刻，再把累计时刻量化到可实现的红石刻，并检查量化后的相邻间隔
- 带 0.5 rt 的节奏不能只靠中继器精确实现。默认应选择可解释的整数刻近似或调整 BPM；只有用户要求高精度且目标版本可验证时，才采用活塞、方块更新或漏斗等半刻/特殊延迟结构，并说明噪音与版本风险

### 琶音与分解和弦
- 琶音是把和弦音按时间先后逐个触发，不是同拍齐奏。只有乐谱明确标注琶音、分解和弦或伴奏型时才顺序展开；普通和弦仍必须在同一累计红石刻并行触发
- 先确定和弦的实际音高与转位，再选择音序：上行如 root→third→fifth→octave；下行反向；往返应避免在转向处重复最高/最低音，例如 0→4→7→12→7→4。不得把所有和弦固定套成同一种顺序
- 明确每步的节奏单位 arpStep。若使用八分音符，stepRt=300/BPM；十六分音符为 150/BPM；三十二分音符为 75/BPM。琶音第 i 个音的理论时刻为 chordStart+i×stepRt
- 纯中继器琶音的单步最小值是 1 rt。stepRt<1 时不能靠普通中继器保持顺序，应降低速度、改用较粗的节奏单位，或在明确版本风险后使用经过验证的亚红石刻结构
- stepRt 为小数时按“累计时刻”量化，交替使用相邻整数延迟保持平均速度，例如 2.5 rt 使用 2、3、2、3…，不能把每一步都舍入为 2 或都舍入为 3
- 在 75 BPM 下八分音符琶音每步 4 rt、十六分音符每步 2 rt；100 BPM 下分别为 3 rt 和 1.5 rt；150 BPM 下分别为 2 rt 和 1 rt。优先选择能被现有红石刻准确表达的速度与细分
- 最简单的物理结构是沿信号方向交替放置“中继器→音符盒→中继器→音符盒”，每个中继器从侧面定向激活下一个音符盒；也可以使用与主节拍同步的独立琶音支路，但不要让红石粉同时激活相邻的多个琶音音符
- 每个琶音音符应是独立时间轴事件。若复用同一个音符盒，下一次触发前必须存在断电阶段；快速琶音优先使用一个事件一个音符盒，减少吞音和状态耦合
- 琶音型必须适配和弦持续时间：检查最后一个音不会无意越过下一个和弦起点。需要跨拍或重叠时必须明确记录为设计意图
- 连续和弦之间优先选择平滑转位以减少不必要的大跳，但不能改变用户给定的低音线或旋律最高音。不同声部同时包含琶音时，各自独立量化，并在每个小节边界重新核对累计时刻

### 音高与音色
- note 共有 0-24 共 25 个半音：0=F♯，1=G，2=G♯/A♭，3=A，4=A♯/B♭，5=B，6=C，7=C♯/D♭，8=D，9=D♯/E♭，10=E，11=F，12=F♯；13-24 为高一八度的同一顺序
- 标准音域（harp 等）为 F♯3-F♯5；bass/didgeridoo 低两个八度，guitar 低一个八度，flute/cow_bell 高一个八度，bell/chime/xylophone 高两个八度。目标音超出所选乐器音域时，优先移调八度或换乐器，并说明变化
- 必须显式写出 instrument、note、powered 方块状态；投影所需音色来自调色板 NBT 中的 instrument 状态，不能只依靠音符盒下方的材质推断
- 优先使用 redstone.noteBlock(instrument, note)，不要仅写 block("minecraft:note_block")。常用 instrument ID：harp、bass、basedrum、snare、hat、flute、bell、guitar、chime、xylophone、iron_xylophone、cow_bell、didgeridoo、bit、banjo、pling
- 下方材质可以与 instrument 对应，以方便玩家理解和游戏更新后的物理一致性，但显式 instrument 状态仍是投影的权威值
- Java 1.20+ 的 zombie/skeleton/creeper/dragon/wither_skeleton/piglin 等生物头颅音色是例外：对应头颅应放在音符盒上方且仍能发声；custom_head 还需要玩家头的 note_block_sound NBT。不要把合法头颅误判成普通遮挡

### 激活、布线与空间
- 先区分用途：需要演奏普通音符的音符盒，上方一格必须是 minecraft:air；Java 1.20+ 的合法生物头颅音色允许对应头颅在上方
- 如果设计目的就是让音符盒静音（例如利用方块更新或制作静音按钮），允许用普通方块或红石部件遮挡上方；必须在源码注释中标记“故意静音”，不得误用于应发声的声部
- 红石粉会激活它指向的方块和其所在方块，密集声部中容易串音。优先让中继器输出端从侧面直接激活音符盒，或使用隔离的定向脉冲；尽量不要用红石粉直接贴着音符盒激活
- 调用 redstone.repeater(signalDirection, { delay }) 时，signalDirection 是信号传播方向，必须指向下一个元件或音符盒；引擎写入的 block-state facing 与传播方向相反
- 音符盒在信号上升沿播放；同一个音符盒再次演奏前必须先断电。不要用持续开启的拉杆直接驱动整首曲目，优先使用按钮或单脉冲启动，并检查脉冲宽度不会吞掉快速重复音
- 和弦与多声部使用并行支路；同一拍的所有支路必须具有相同累计延迟。长线路需标记/分色声部，避免红石粉跨线连接；结构附近避免未受控水流
- 循环段必须有明确循环周期、退出门和重新触发保护；可用活塞门或漏斗计时控制段落切换，但必须保证退出时不会产生额外音符或常供电

### 提交前检查清单
- 每个事件：instrument、note 0-24、目标拍点、是否休止、是否应发声均已明确
- 每条路径：中继器朝向正确、单个 delay 1-4、累计延迟与量化时间轴一致
- 每个和弦：所有声部在同一累计红石刻抵达；每个重复音之间存在断电阶段
- 每个琶音：音序、转位、arpStep、起止时刻和跨和弦行为均已明确；确认它没有被误做成齐奏和弦，也没有因串线变成齐奏
- 每个普通发声音符盒顶部为空气；每个头颅音色的头颅和版本正确；每个被遮挡的普通音符盒确实标注为故意静音
- 检查红石粉误激活、支路串线、常供电、遗漏休止、BPM 漂移和循环无法退出
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
      case "redstone-music":
        parts.push(REDSTONE_MUSIC_MODULE);
        break;
    }
  }
  return parts.join("\n\n");
}
