import { openaiClient } from './services/openai-client.js'
import type * as types from './types.js'

const tweetFilterSystemPrompt = `You are a tweet relevance analyst for a trading AI assistant focused on US equities and crypto markets. Your task is to determine whether a tweet is worth replying to.

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

export interface TweetFilterResult {
  worthReplyingTo: boolean
  reason: string
}

export async function checkTweetRelevance(
  tweetText: string,
  _ctx: types.AnswerEngineContext
): Promise<TweetFilterResult> {
  try {
    const res = await openaiClient.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: tweetFilterSystemPrompt },
        { role: 'user', content: tweetText }
      ],
      max_tokens: 150,
      temperature: 0
    })

    const content = res.choices[0]?.message?.content?.trim()
    if (!content) {
      console.warn('tweet filter returned empty response, defaulting to true')
      return { worthReplyingTo: true, reason: 'filter returned empty response' }
    }

    const parsed = JSON.parse(content)
    const result: TweetFilterResult = {
      worthReplyingTo: !!parsed.worth_replying_to,
      reason: parsed.reason || ''
    }

    console.log('tweet filter result:', {
      tweet: tweetText.slice(0, 100),
      ...result
    })

    return result
  } catch (err: any) {
    console.warn('tweet filter error, defaulting to true:', err.message)
    return { worthReplyingTo: true, reason: `filter error: ${err.message}` }
  }
}
