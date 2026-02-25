import defaultKy, { type KyInstance } from 'ky'

export interface AlvaChatRequest {
  message: string
  skill_id: string
  session_kind: string
  input_image_urls: string[]
  timezone: string
  timezone_offset_min: number
  session_id?: string
}

export interface AlvaChatStreamChunk {
  info?: { info_id: string; node_info: string }
  session_id?: string
  question_id?: string
  answer_id?: string
  session_name?: string
  msg?: string
}

export class AlvaClient {
  readonly apiBaseUrl: string
  readonly jwtToken: string
  readonly skillId: string
  readonly ky: KyInstance

  constructor({
    jwtToken = process.env.ALVA_JWT_TOKEN,
    apiBaseUrl = process.env.ALVA_API_BASE_URL ||
      'https://api-llm2.prd.alva.xyz',
    skillId = process.env.ALVA_SKILL_ID || '1940947595121053696',
    ky = defaultKy
  }: {
    jwtToken?: string
    apiBaseUrl?: string
    skillId?: string
    ky?: KyInstance
  } = {}) {
    if (!jwtToken) {
      throw new Error('ALVA_JWT_TOKEN is required')
    }

    this.jwtToken = jwtToken
    this.apiBaseUrl = apiBaseUrl
    this.skillId = skillId
    this.ky = ky.extend({ prefixUrl: this.apiBaseUrl })
  }

  async generateResponse(message: string): Promise<string> {
    const body: AlvaChatRequest = {
      message,
      skill_id: this.skillId,
      session_kind: 'Ask',
      input_image_urls: [],
      timezone: 'Asia/Shanghai',
      timezone_offset_min: 480
    }

    const response = await this.ky.post('chat', {
      json: body,
      headers: {
        Authorization: this.jwtToken,
        'X-Platform': 'api'
      },
      timeout: 120_000
    })

    const text = await response.text()
    return this.parseStreamResponse(text)
  }

  private parseStreamResponse(raw: string): string {
    const lines = raw.split('\n').filter(Boolean)
    const parts: string[] = []
    let generating = false

    for (const line of lines) {
      try {
        const chunk = JSON.parse(line) as AlvaChatStreamChunk

        if (chunk.msg === '<GENERATING>') {
          generating = true
          continue
        }

        if (chunk.msg === '</GENERATING>') {
          generating = false
          continue
        }

        if (chunk.msg != null && generating) {
          parts.push(chunk.msg)
        }
      } catch {
        // skip malformed lines
      }
    }

    return parts.join('')
  }
}
