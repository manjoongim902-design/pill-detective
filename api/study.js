import Anthropic from "@anthropic-ai/sdk";

// ANTHROPIC_API_KEY는 Vercel 환경 변수에서 읽어요. 브라우저에는 절대 노출되지 않아요.
const client = new Anthropic();

const MODEL = "claude-opus-5-5";

const BASE_SYSTEM = `당신은 대학생을 돕는 한국어 AI 학습 튜터예요.
사용자가 올린 학습 자료(PDF 또는 텍스트)를 근거로 답하고, 자료에 없는 내용은 "자료에는 없지만"이라고 밝힌 뒤 일반 지식으로 보충해요.
설명은 쉽고 친절하게, 핵심부터 말해요. 수식이나 코드는 마크다운으로 써요.`;

const MODES = {
  chat: {
    effort: "medium",
    instruction: null,
  },
  summary: {
    effort: "medium",
    instruction: `이 자료를 시험 대비용으로 요약해 주세요.
형식: 마크다운. "## 한 줄 요약" → "## 핵심 개념" (개념마다 2~3줄 설명) → "## 꼭 외울 것" (불릿) → "## 헷갈리기 쉬운 포인트" 순서로.`,
  },
  quiz: {
    effort: "medium",
    instruction: `이 자료로 시험에 나올 법한 객관식 문제 8개를 만들어 주세요.
쉬운 문제부터 어려운 문제 순서로, 보기는 4개, 해설은 왜 정답이고 오답은 왜 틀렸는지 짧게.`,
    schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              choices: { type: "array", items: { type: "string" } },
              answer_index: { type: "integer" },
              explanation: { type: "string" },
            },
            required: ["question", "choices", "answer_index", "explanation"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
  flashcards: {
    effort: "low",
    instruction: `이 자료의 핵심 용어와 개념으로 암기용 플래시카드 12장을 만들어 주세요.
앞면은 짧은 용어나 질문, 뒷면은 1~2문장 설명.`,
    schema: {
      type: "object",
      properties: {
        cards: {
          type: "array",
          items: {
            type: "object",
            properties: {
              front: { type: "string" },
              back: { type: "string" },
            },
            required: ["front", "back"],
            additionalProperties: false,
          },
        },
      },
      required: ["cards"],
      additionalProperties: false,
    },
  },
};

// 자료 블록. 같은 자료로 여러 번 질문해도 캐시를 재사용하도록 cache_control을 붙여요.
function materialBlock(material) {
  if (material.type === "pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: material.data },
      title: material.name || "학습 자료",
      cache_control: { type: "ephemeral" },
    };
  }
  return {
    type: "text",
    text: `<학습자료 제목="${material.name || "학습 자료"}">\n${material.data}\n</학습자료>`,
    cache_control: { type: "ephemeral" },
  };
}

function buildMessages(mode, material, history) {
  const first = [materialBlock(material)];
  const cfg = MODES[mode];

  if (mode !== "chat") {
    first.push({ type: "text", text: cfg.instruction });
    return [{ role: "user", content: first }];
  }

  // 튜터 대화: 자료를 첫 질문 앞에 붙이고, 이후 대화는 그대로 이어 붙여요.
  const turns = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-40);
  if (!turns.length || turns[0].role !== "user") throw new HttpError(400, "질문이 비어 있어요.");

  return [
    { role: "user", content: [...first, { type: "text", text: turns[0].content }] },
    ...turns.slice(1).map((m) => ({ role: m.role, content: m.content })),
  ];
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST만 지원해요." });
  }

  let messages, cfg;
  try {
    const { mode, material, messages: history = [] } = req.body || {};
    cfg = MODES[mode];
    if (!cfg) throw new HttpError(400, "알 수 없는 기능이에요.");
    if (!material || !material.data || !["pdf", "text"].includes(material.type)) {
      throw new HttpError(400, "먼저 학습 자료를 올려 주세요.");
    }
    messages = buildMessages(mode, material, history);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const params = {
    model: MODEL,
    max_tokens: 32000,
    system: BASE_SYSTEM,
    output_config: { effort: cfg.effort },
    messages,
    // 안전 분류기가 거절하면 서버 측에서 권장 모델로 자동 재시도해요.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
  if (cfg.schema) params.output_config.format = { type: "json_schema", schema: cfg.schema };

  // 텍스트를 받는 대로 브라우저로 흘려보내요(일반 텍스트 스트림).
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });

  try {
    const stream = client.beta.messages.stream(params);
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        res.write(event.delta.text);
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      res.write("\n\n[[ERROR]]이 요청에는 답할 수 없어요. 질문을 바꿔서 다시 시도해 주세요.");
    } else if (final.stop_reason === "max_tokens") {
      res.write("\n\n[[ERROR]]답변이 너무 길어서 중간에 끊겼어요. 자료를 나눠서 올려 주세요.");
    }
  } catch (err) {
    res.write(`\n\n[[ERROR]]${friendlyError(err)}`);
  }
  res.end();
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "서버의 API 키가 올바르지 않아요. 관리자에게 알려 주세요.";
  if (err instanceof Anthropic.RateLimitError) return "지금 요청이 많아요. 잠시 후 다시 시도해 주세요.";
  if (err instanceof Anthropic.BadRequestError) return "자료를 처리할 수 없어요. 파일이 너무 크거나 손상됐는지 확인해 주세요.";
  if (err instanceof Anthropic.APIError) return `AI 서버 오류가 났어요 (${err.status ?? "연결"}). 잠시 후 다시 시도해 주세요.`;
  console.error(err);
  return "알 수 없는 오류가 났어요.";
}
