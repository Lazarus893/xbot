import { type AnswerEngine } from './answer-engine.js'
import { AlvaAnswerEngine } from './answer-engines/alva-answer-engine.js'
import { OpenAIAnswerEngine } from './answer-engines/openai-answer-engine.js'
import type * as types from './types.js'

export function createAnswerEngine(
  answerEngineType: types.AnswerEngineType
): AnswerEngine {
  switch (answerEngineType) {
    case 'openai':
      return new OpenAIAnswerEngine()

    case 'alva':
      return new AlvaAnswerEngine()

    default:
      throw new Error(`Unknown answer engine: ${answerEngineType}`)
  }
}
