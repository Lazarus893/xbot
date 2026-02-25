import * as config from './config.js'
import { openaiClient } from './services/openai-client.js'
import type * as types from './types.js'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type TweetFilterMode = 'alva1' | 'alva2'

export interface TweetFilterResult {
  worthReplyingTo: boolean
  reason: string
  /** Alva2.0 only — confidence score 0-1 */
  confidence?: number
  /** Alva2.0 only — suggested reply angle */
  replyAngle?: string
  /** Alva2.0 only — detected topic tags */
  topicTags?: string[]
}

// ---------------------------------------------------------------------------
// Alva1.0 — simple LLM yes/no filter
// ---------------------------------------------------------------------------

const alva1SystemPrompt = `You are a tweet relevance analyst for a trading AI assistant focused on US equities and crypto markets. Your task is to determine whether a tweet is worth replying to.

Judgment criteria — if ANY of the following conditions is met, the tweet is NOT worth replying to (return false):

1. The tweet is only about general entertainment (celebrity gossip, memes with no market context, sports, etc.) with no connection to financial markets or web3.
2. The tweet is merely sharing ordinary life moments (food, travel, selfies) rather than investment, trading, or market-related thoughts.
3. The tweet only discusses politics with no connection to the economy, financial markets, or the web3 industry. Note: political events that could impact markets (e.g. tariffs, regulations, Fed appointments) ARE worth replying to.
4. The tweet is too short or vague to identify any meaningful market-related information (e.g. just "gm" or "hi" or a single emoji).
5. The tweet is a giveaway, airdrop raffle, or purely promotional spam with no analytical content.

Note: Discussing market events, macro news, or project developments in a joking or sarcastic tone STILL counts as worth replying to — humor does not disqualify relevance.

Topics that ARE worth replying to include but are not limited to:
- US stock market analysis, earnings, Fed policy, macro data
- Crypto market movements, token analysis, on-chain data
- Specific tickers ($BTC, $ETH, $SOL, $AAPL, $NVDA, etc.) or contract addresses
- Trading ideas, technical analysis, market sentiment
- DeFi protocols, NFT market trends, exchange listings
- Regulatory news impacting crypto or equities
- Important tech/economic announcements with market implications

You must respond with ONLY a valid JSON object, no other text:
{
  "worth_replying_to": true or false,
  "reason": "brief explanation for the decision"
}`

async function checkAlva1(tweetText: string): Promise<TweetFilterResult> {
  const res = await openaiClient.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: alva1SystemPrompt },
      { role: 'user', content: tweetText }
    ],
    max_tokens: 150,
    temperature: 0
  })

  const content = res.choices[0]?.message?.content?.trim()
  if (!content) {
    return { worthReplyingTo: true, reason: 'filter returned empty response' }
  }

  const parsed = JSON.parse(content) as {
    worth_replying_to?: boolean
    reason?: string
  }
  return {
    worthReplyingTo: !!parsed.worth_replying_to,
    reason: parsed.reason || ''
  }
}

// ---------------------------------------------------------------------------
// Alva2.0 — two-layer filter: hard rules + semantic LLM
// ---------------------------------------------------------------------------

const PROMO_PATTERNS = [
  /\bgiveaway\b/i,
  /\bairdrop\b/i,
  /\bwhitelist\b/i,
  /\bWL spot/i,
  /\bRT\s*[+&]\s*follow/i,
  /\blike\s*[+&]\s*retweet/i,
  /\bfree\s+mint\b/i,
  /\btag\s+\d+\s+friends?\b/i,
  /\bjoin\s+(our\s+)?discord/i,
  /bit\.ly\//i,
  /t\.me\//i
]

const TWEET_MIN_LENGTH = 20
const TWEET_MAX_AGE_MS = 2 * 60 * 60 * 1000 // 2 hours

interface Alva2HardFilterInput {
  text: string
  referencedTweets?: { type: string; id: string }[]
  createdAt?: string
}

function checkAlva2HardRules(
  input: Alva2HardFilterInput
): TweetFilterResult | null {
  const { text, referencedTweets, createdAt } = input

  const isRetweet = referencedTweets?.some((t) => t.type === 'retweeted')
  if (isRetweet) {
    return { worthReplyingTo: false, reason: 'pure retweet' }
  }

  const strippedText = text
    .replace(/@\w+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim()

  if (strippedText.length < TWEET_MIN_LENGTH) {
    return {
      worthReplyingTo: false,
      reason: `too short (${strippedText.length} chars after stripping mentions/URLs)`
    }
  }

  const emojiOnly = /^[\p{Emoji}\s]+$/u.test(strippedText)
  if (emojiOnly) {
    return { worthReplyingTo: false, reason: 'emoji-only content' }
  }

  for (const pattern of PROMO_PATTERNS) {
    if (pattern.test(text)) {
      return {
        worthReplyingTo: false,
        reason: `promotional/spam content (matched: ${pattern.source})`
      }
    }
  }

  if (createdAt) {
    const tweetAge = Date.now() - new Date(createdAt).getTime()
    if (tweetAge > TWEET_MAX_AGE_MS) {
      const ageMinutes = Math.round(tweetAge / 60_000)
      return {
        worthReplyingTo: false,
        reason: `tweet too old (${ageMinutes} minutes ago, limit is 120)`
      }
    }
  }

  return null
}

const alva2SystemPrompt = `You are a tweet relevance analyst for Alva, a high-performance trading AI assistant focused on US equities and crypto markets. You evaluate tweets from KOLs and market participants to determine if Alva should reply.

Evaluate the tweet on three dimensions:

1. **Topic Match**: Does the tweet involve market analysis, trading strategy, macro data, on-chain metrics, individual stocks/crypto, earnings, Fed policy, regulatory news, or any domain where Alva has expertise?

2. **Incremental Value**: Can Alva provide substantive additional analysis — such as historical data validation, quantitative verification, alternative perspectives, risk assessment, or deeper context — rather than merely agreeing or restating the point?

3. **Reply Appropriateness**: Is the tweet's tone suitable for an analytical reply? Exclude pure emotional venting, personal life updates, jokes with zero market context, and generic greetings. Sarcasm or humor about markets IS appropriate.

Decision rules:
- If topic does NOT match Alva's domains → skip
- If Alva cannot add incremental value → skip
- If reply would be inappropriate or awkward → skip
- Otherwise → reply

You must respond with ONLY a valid JSON object, no other text:
{
  "decision": "reply" or "skip",
  "confidence": 0.0 to 1.0,
  "reply_angle": "suggested approach for the reply, e.g. 'validate claim with historical BTC halving data'",
  "topic_tags": ["macro", "crypto", "earnings", "defi", "technical", "sentiment", "regulatory", "onchain"],
  "reason": "brief explanation"
}`

async function checkAlva2Semantic(
  tweetText: string
): Promise<TweetFilterResult> {
  const res = await openaiClient.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: alva2SystemPrompt },
      { role: 'user', content: tweetText }
    ],
    max_tokens: 250,
    temperature: 0
  })

  const content = res.choices[0]?.message?.content?.trim()
  if (!content) {
    return { worthReplyingTo: true, reason: 'filter returned empty response' }
  }

  const parsed = JSON.parse(content) as {
    decision?: string
    reason?: string
    confidence?: number
    reply_angle?: string
    topic_tags?: string[]
  }
  return {
    worthReplyingTo: parsed.decision === 'reply',
    reason: parsed.reason || '',
    confidence: parsed.confidence,
    replyAngle: parsed.reply_angle,
    topicTags: parsed.topic_tags
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkTweetRelevance(
  tweetText: string,
  _ctx: types.AnswerEngineContext,
  opts?: {
    referencedTweets?: { type: string; id: string }[]
    createdAt?: string
  }
): Promise<TweetFilterResult> {
  const mode = config.tweetFilterMode

  try {
    if (mode === 'alva1') {
      return await checkAlva1(tweetText)
    }

    const hardResult = checkAlva2HardRules({
      text: tweetText,
      referencedTweets: opts?.referencedTweets,
      createdAt: opts?.createdAt
    })

    if (hardResult) {
      console.log('tweet filter [alva2/hard]:', {
        tweet: tweetText.slice(0, 100),
        ...hardResult
      })
      return hardResult
    }

    const semanticResult = await checkAlva2Semantic(tweetText)

    console.log('tweet filter [alva2/semantic]:', {
      tweet: tweetText.slice(0, 100),
      ...semanticResult
    })

    return semanticResult
  } catch (err: any) {
    console.warn(
      `tweet filter [${mode}] error, defaulting to true:`,
      err.message
    )
    return { worthReplyingTo: true, reason: `filter error: ${err.message}` }
  }
}
