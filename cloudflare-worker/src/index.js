const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function getAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return '*';

  const allowedOrigins = splitList(env.ALLOWED_ORIGINS);
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    return origin;
  }

  return origin;
}

function corsHeaders(request, env) {
  const allowedOrigin = getAllowedOrigin(request, env);
  return {
    'Access-Control-Allow-Origin': allowedOrigin || 'null',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function uniqueNames(names) {
  const seen = new Set();
  const output = [];

  for (const name of names || []) {
    const fullName = String(name?.fullName || name?.name || name || '').trim();
    const key = fullName.toLowerCase().replace(/[^a-z]/g, '');
    if (!key || seen.has(key)) continue;

    seen.add(key);
    output.push({ fullName });
  }

  return output;
}

function getInlineImageParts(imageDataUrl) {
  const match = String(imageDataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) return null;

  return {
    mimeType: match[1].toLowerCase(),
    data: match[2].replace(/\s/g, '')
  };
}

function extractOutputText(responseJson) {
  const chunks = [];

  for (const candidate of responseJson?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (typeof part?.text === 'string') {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

async function verifyFirebaseUser(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return null;

  const verifyUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`;
  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: tokenMatch[1] })
  });

  if (!response.ok) return null;

  const payload = await response.json();
  const user = Array.isArray(payload.users) ? payload.users[0] : null;
  if (!user?.localId || !user.email) return null;

  const allowedEmails = splitList(env.ADMIN_EMAILS).map(email => email.toLowerCase());
  if (allowedEmails.length && !allowedEmails.includes(String(user.email).toLowerCase())) {
    return null;
  }

  return user;
}

function buildPrompt({ meetingTitle, scanDate, roster }) {
  return [
    'Read the handwritten names on this CSHS signup sheet.',
    'Return only JSON with this shape: {"names":[{"fullName":"First Last"}]}',
    'Do not include printed instructions, blank lines, dates, titles, decorative text, or phone numbers.',
    'Read names left column top-to-bottom, then right column top-to-bottom.',
    'Transcribe the visible handwriting. New members may not be in the roster; include their names exactly as read.',
    'Never replace a written name with the closest roster name. The roster is optional spelling context only when the handwriting clearly supports it.',
    'Do not invent a name for illegible handwriting. An administrator will review and match the transcription.',
    'Do not add people who do not appear to have signed the sheet.',
    `Meeting title: ${meetingTitle || ''}`,
    `Scan date: ${scanDate || ''}`,
    `Member roster JSON: ${JSON.stringify(roster)}`
  ].join('\n');
}

async function readAttendanceWithGemini(body, env) {
  const { image, meetingTitle, scanDate, memberRoster = [] } = body || {};
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return { error: 'Missing image data URL.', status: 400 };
  }

  const inlineImage = getInlineImageParts(image);
  if (!inlineImage) {
    return { error: 'Image must be a base64 data URL.', status: 400 };
  }

  const roster = Array.isArray(memberRoster)
    ? memberRoster.map(name => String(name || '').trim()).filter(Boolean)
    : [];

  const prompt = buildPrompt({ meetingTitle, scanDate, roster });
  const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
  const requestBody = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: inlineImage.mimeType,
              data: inlineImage.data
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.15,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                fullName: { type: 'string' }
              },
              required: ['fullName']
            }
          }
        },
        required: ['names']
      }
    }
  });

  const geminiUrl = `${GEMINI_API_URL}/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const retryableStatuses = new Set([429, 500, 503]);
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: requestBody
    });

    const responseJson = await geminiResponse.json().catch(() => ({}));
    if (geminiResponse.ok) {
      const parsed = parseJsonObject(extractOutputText(responseJson));
      return {
        names: uniqueNames(parsed.names),
        source: 'gemini'
      };
    }

    const errorMessage = responseJson?.error?.message || 'Gemini request failed.';
    lastError = { status: geminiResponse.status, message: errorMessage };
    if (!retryableStatuses.has(geminiResponse.status) && !/high demand|busy|temporarily unavailable|rate limit|resource exhausted/i.test(errorMessage)) {
      break;
    }

    if (attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, attempt * 750));
    }
  }

  return {
    error: lastError?.message || 'Gemini request failed.',
    status: lastError?.status || 500
  };
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response('', {
        status: getAllowedOrigin(request, env) ? 204 : 403,
        headers
      });
    }

    if (url.pathname === '/api/health') {
      return jsonResponse({
        ok: true,
        service: 'NG CSHS Attendance AI',
        model: env.GEMINI_MODEL || 'gemini-3.6-flash',
        hasGeminiKey: Boolean(env.GEMINI_API_KEY)
      }, 200, headers);
    }

    if (url.pathname !== '/api/read-attendance') {
      return jsonResponse({ ok: true, service: 'NG CSHS Attendance AI' }, 200, headers);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Use POST.' }, 405, headers);
    }

    const user = await verifyFirebaseUser(request, env);
    if (!user) {
      return jsonResponse({ error: 'Admin login required.' }, 401, headers);
    }

    if (!env.GEMINI_API_KEY) {
      return jsonResponse({ error: 'GEMINI_API_KEY is not configured in Cloudflare.' }, 500, headers);
    }

    try {
      const body = await request.json();
      const result = await readAttendanceWithGemini(body, env);
      if (result.error) {
        return jsonResponse({ error: result.error }, result.status || 500, headers);
      }

      return jsonResponse(result, 200, headers);
    } catch (error) {
      console.error('Attendance Worker failed:', error);
      return jsonResponse({ error: 'Attendance AI failed.' }, 500, headers);
    }
  }
};
