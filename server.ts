import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Helper to get Gemini Client safely
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// 智能模型容灾容错与自动切换机制：防止用户使用的模型因配额耗尽(429/503)导致解析失败
async function generateContentWithFallback(
  ai: GoogleGenAI,
  requestedModel: string,
  params: any
) {
  const allModels = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"];
  // 按照偏好排定最终兜底链条
  const fallbackChain = [requestedModel, ...allModels.filter(m => m !== requestedModel)];

  let lastError: any = null;
  for (let i = 0; i < fallbackChain.length; i++) {
    const currentModel = fallbackChain[i];
    try {
      console.log(`[AI 引擎] 尝试调用模型: ${currentModel} (轮次 ${i + 1}/${fallbackChain.length})`);
      
      const payload = {
        ...params,
        model: currentModel,
      };
      
      const response = await ai.models.generateContent(payload);
      return {
        response,
        usedModel: currentModel,
        fallbackCount: i,
      };
    } catch (err: any) {
      console.error(`[AI 引擎重试分流] 模型 ${currentModel} 返回错误 (准备尝试兜底):`, err.message || err);
      lastError = err;
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON size limit for large page lists
  app.use(express.json({ limit: "50mb" }));

  // API Route: Home/Status
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // API Route: 解析目录页文本
  app.post("/api/gen-outline-from-toc", async (req, res) => {
    try {
      const { tocText, userInstructions, model } = req.body;
      if (!tocText || typeof tocText !== "string") {
        return res.status(400).json({ error: "tocText is required and must be a string." });
      }

      const ai = getGeminiClient();
      const requestedModel = model || "gemini-3.5-flash";
      const systemInstruction = `
你是一个专业的学术教材和医学备考笔记目录解析器。
你的任务是将用户提供的PDF目录（TOC）页面的原始文本，解析成清晰的树状层级书签，并指出可能存在的页码。
目录中每行可能包含标题、引导符（如 . . . ）、以及页码。

要求：
1. 分析每一行，提取出标题（title）和它对应的目录页码（pageNumber）。
2. 根据排版、字号、序号（如 “一、”, “第一章”, “1.”, “(1)”），推断每一个标题的级别（level）。level 从 1 开始，一般 1 代表最上层的章，2 代表节，3 代表小节。默认限制在一级或二级，除非文章结构复杂。
3. 页码必须解析为纯数字，如果某行没有页码，设为 0。
4. 尝试估算“实际PDF页码与目录排版页码的偏移量”（detectedOffset）。偏移量 = 实际PDF页面号 - 目录里印刷的页面号。如果你没有足够信息来计算偏移，返回 0。
5. 必须返回符合JSON Schema规范的结果。
6. 用户可能提供了辅助说明："${userInstructions || '无'}"，请参考该说明对提取结果进行微调（例如修正特定的级别划分或名称）。
`;

      const promptText = `请解析以下目录文本，并将其转换为规范的层级书签列表：\n\n${tocText}`;

      const { response, usedModel, fallbackCount } = await generateContentWithFallback(ai, requestedModel, {
        contents: promptText,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              bookmarks: {
                type: Type.ARRAY,
                description: "解析出来的书签列表，保持顺序",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING, description: "标题文本，去掉标题前后的点号和页码，保留正文名称" },
                    pageNumber: { type: Type.INTEGER, description: "目录中标注的原始页码，若无页码写0" },
                    level: { type: Type.INTEGER, description: "标题层级，1表示第一级，2表示第二级，3表示第三级" },
                  },
                  required: ["title", "pageNumber", "level"],
                },
              },
              detectedOffset: { type: Type.INTEGER, description: "自动检测到的页码偏移量（物理PDF页码减去目录页码），若无法判断返回0" },
            },
            required: ["bookmarks", "detectedOffset"],
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty response from Gemini API");
      }

      const parsedData = JSON.parse(responseText.trim());
      res.json({
        ...parsedData,
        usedModel,
        fallbackCount,
      });
    } catch (error: any) {
      console.error("gen-outline-from-toc error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // API Route: AI 智能页面段落块 / 页面核心书签生成
  app.post("/api/gen-outline-from-pages", async (req, res) => {
    try {
      const { pages, mode, userInstructions, model } = req.body;
      // pages: Array<{ pageNumber: number, text: string }>
      // mode: 'block' (章节块识别) | 'single' (单页识别)
      
      if (!pages || !Array.isArray(pages) || pages.length === 0) {
        return res.status(400).json({ error: "pages array is required." });
      }

      const ai = getGeminiClient();
      const chosenMode = mode || "block";
      const requestedModel = model || "gemini-3.5-flash";

      const systemInstruction = chosenMode === "block" 
        ? `
你是一位智能学习资料阅读助手。
用户的PDF没有任何目录，需要你根据从各页提取出来的前几百个字符（预览文本），智能地找出里面章节的划分、知识点切换点。
你应当自动识别连续的一组页面是一个特定的“章节/知识点主题”（如“呼吸衰竭”、“第二节 气胸”等），并把该章节的第一个页面的绝对页面号作为书签绑定页。

要求：
1. 浏览页面列表，寻找显式的标题（例如：“第X章”、“第X节”、“一、诊断标准”等）或核心内容的宏观切换点。
2. 聚合连续的页面，切勿把每页都拆分出来，寻找最合适的默认一、二级书签层级（level为1或2）。
3. 书签的 pageNumber 必须等于传入的页面真实的 pageNumber。
4. 书签标题（title）应精准易懂，符合教科书/考试学习资料的知识点命名习惯（例如，“肺血栓栓塞症 - 诊断与治疗流程”）。
5. 必须返回符合JSON Schema规范的结果。
6. 用户可能提供了辅助说明："${userInstructions || '无'}"，请结合辅助指令。
`
        : `
你是一位智能学习资料阅读助手。
用户的PDF由于是幻灯片、零碎卡片等形式，每一页都是一个独立的重点。需要你采用“单页识别模式”，为各页生成最清晰简练的学习知识点书签标题。

要求：
1. 分析提供给你的每一页的文本概要，根据这一页包含的主要疾病、定义、或核心考点，给这一页拟定一个高度概括、适合检索的书签标题（例如，“高血压定义与分级”、“心力衰竭病因”、“病例分析1”）。
2. 在这个模式下，你给所有传入的有代表性的页面各生成一个书签（若页面空白或无意义可跳过）。默认 level 为 1，若属于前面页面的子属性页面可以设定为 2。
3. 书签对应真实的 pageNumber 必须来自传入页面的 pageNumber。
4. 必须返回符合JSON Schema规范的结果。
5. 用户可能提供了辅助说明："${userInstructions || '无'}"，请参考。
`;

      const promptText = `
以下是需要你分析的各页文本概要（形式为 { pageNumber: 数字, text: "正文前几百个字概要" } 列表）：

${JSON.stringify(pages, null, 2)}

请根据上述要求和模式 "${chosenMode}" 进行智能书签设计：`;

      const { response, usedModel, fallbackCount } = await generateContentWithFallback(ai, requestedModel, {
        contents: promptText,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              bookmarks: {
                type: Type.ARRAY,
                description: "生成的智能书签列表",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING, description: "书签名称，简明，代表该知识点/章节名称" },
                    pageNumber: { type: Type.INTEGER, description: "对应的真实的物理页面号(从传入数据获取)" },
                    level: { type: Type.INTEGER, description: "书签层级 (1 或 2)" },
                  },
                  required: ["title", "pageNumber", "level"],
                },
              },
            },
            required: ["bookmarks"],
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty response from Gemini API");
      }

      const parsedData = JSON.parse(responseText.trim());
      res.json({
        ...parsedData,
        usedModel,
        fallbackCount,
      });
    } catch (error: any) {
      console.error("gen-outline-from-pages error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // Vite development middleware vs production static files
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting in development mode with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting in production mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
