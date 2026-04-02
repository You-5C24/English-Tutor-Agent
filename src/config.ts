/** 主对话 / 分类 / 摘要统一使用的模型名称 */
export const CHAT_MODEL = 'kimi-k2.5';

/** 对话轮数超过此值时触发摘要压缩（1 轮 = 1 条 user + 1 条 assistant） */
export const COMPRESS_THRESHOLD = 10;

/** 压缩时保留最近 N 轮原始对话，更早的部分压缩为摘要 */
export const KEEP_RECENT_ROUNDS = 5;

/** RAG 检索返回的最大条数 */
export const RAG_TOP_K = 3;

/** RAG 结果的最低相似度阈值，低于此分数的条目不注入 system prompt */
export const RAG_MIN_SCORE = 0.5;

/** Tool Use Loop 最大迭代次数，防止 LLM 异常时无限循环 */
export const MAX_TOOL_ITERATIONS = 3;

/** generateSummary() 的最大输出 token 数 */
export const SUMMARY_MAX_TOKENS = 150;

/** HTTP 服务监听端口 */
export const SERVER_PORT = Number(process.env.PORT) || 3000;

/** SQLite 数据库文件路径（相对于项目根目录） */
export const DB_PATH = 'data/english-tutor.db';

/** 前端历史消息加载条数上限 */
export const DISPLAY_MESSAGE_LIMIT = 30;
