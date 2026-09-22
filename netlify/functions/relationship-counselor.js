const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  },
  body: JSON.stringify(body),
});

const SYSTEM_PROMPT = `تو «مشاور رابطه» برای یک زوج به نام فاضل و الهام هستی.
نقش تو میانجی بی‌طرف است، نه داور و نه طرفدار یکی از دو نفر.

قواعد:
- بین اتفاق/واقعیت، برداشت، احساس و نیاز/درخواست تفاوت بگذار.
- هیچ‌کدام را سرزنش، تحقیر یا مسخره نکن.
- درباره نیت‌های پنهان حدس قطعی نزن.
- اگر اطلاعات کافی نیست، سؤال روشن‌کننده بپرس.
- حرف هر دو نفر را با وزن برابر و با دقت بررسی کن.
- به جای تعیین مقصر، روی مسئله، نیازهای دو طرف و راه‌حل قابل اجرا تمرکز کن.
- اگر مناسب بود، جمله‌های آماده برای گفت‌وگوی آرام پیشنهاد بده.
- اگر هر دو نفر روی یک راه‌حل توافق کردند، آن را به یک توافق کوتاه، روشن و دوطرفه تبدیل کن.
- اگر یکی از دو نفر هنوز ناراضی است، توافق را تحمیل نکن و سؤال روشن‌کننده بپرس.
- از اطلاعات خصوصی یک نفر برای فشار آوردن به نفر دیگر استفاده نکن.
- تشخیص پزشکی یا روان‌شناختی نده.
- اگر نشانه‌ای از خشونت، تهدید، اجبار، آزار یا خطر فوری وجود دارد، اولویت با امنیت فرد در معرض خطر است.
- پاسخ‌ها فارسی، گرم، محترمانه و کاربردی باشند.`;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }

  if (event.httpMethod !== "POST") {
    return json(405, {
      error: "Method not allowed",
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return json(500, {
      error: "کلید OpenAI در Netlify تنظیم نشده است.",
    });
  }

  let payload;

  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, {
      error: "درخواست نامعتبر است.",
    });
  }

  const messages = Array.isArray(payload.messages)
    ? payload.messages
    : [];

  const speaker =
    payload.speaker === "الهام"
      ? "الهام"
      : "فاضل";

  const safeMessages = messages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .slice(-24)
    .map((m) => ({
      role: m.role,
      content: String(m.content).slice(0, 5000),
    }));

  if (!safeMessages.length) {
    return json(400, {
      error: "پیامی برای مشاوره ارسال نشده است.",
    });
  }

  const input = [
    {
      role: "developer",
      content: [
        {
          type: "input_text",
          text: SYSTEM_PROMPT,
        },
      ],
    },

    {
      role: "developer",
      content: [
        {
          type: "input_text",
          text:
            `پیام فعلی از طرف «${speaker}» است. فقط برای درک گوینده از این اطلاعات استفاده کن.`,
        },
      ],
    },

    ...safeMessages.map((m) => ({
      role: m.role,
      content: [
        {
          type:
            m.role === "assistant"
              ? "output_text"
              : "input_text",
          text: m.content,
        },
      ],
    })),
  ];

  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${process.env.OPENAI_API_KEY}`,
        },

        body: JSON.stringify({
          model: "gpt-5.6-luna",
          input,
          max_output_tokens: 800,
        }),
      }
    );

    const raw = await response.text();

    let data = {};

    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (_) {
      data = {};
    }

    if (!response.ok) {
      const message =
        data?.error?.message ||
        "خطا در ارتباط با OpenAI";

      return json(
        response.status >= 400 &&
        response.status < 500
          ? response.status
          : 502,
        {
          error: message,
        }
      );
    }

    const reply = (data.output || [])
      .flatMap((item) =>
        item?.type === "message"
          ? item.content || []
          : []
      )
      .filter(
        (item) =>
          item?.type === "output_text" &&
          typeof item.text === "string"
      )
      .map((item) => item.text)
      .join("\n")
      .trim();

    if (!reply) {
      return json(502, {
        error: "OpenAI پاسخ متنی برنگرداند.",
      });
    }

    return json(200, {
      reply,
    });

  } catch (error) {
    console.error(
      "OpenAI request failed:",
      error
    );

    return json(502, {
      error:
        "ارتباط با سرویس مشاوره برقرار نشد.",
    });
  }
};
