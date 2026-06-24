# Модели для подключения (OpenRouter)

Список model ID для подключения по ролям (ТЗ §6). Дефолты конфига —
`packages/engine/src/config.ts`. Ключ задаётся в UI (настройки → Ключ OpenRouter).

## Обязательные (LLM через OpenRouter)

| Роль | Основная модель | Альтернатива |
|------|-----------------|--------------|
| Ведущий (narrator) | `qwen/qwen3-next-80b-a3b-instruct:free` | `nousresearch/hermes-3-llama-3.1-405b:free` |
| Валидатор/нормализатор | `google/gemma-4-31b-it:free` | `openai/gpt-oss-120b:free` |
| Режиссёр + мир-симуляция | `nvidia/nemotron-3-super-120b-a12b:free` | `nvidia/nemotron-3-ultra-550b-a55b:free` |
| Фоллбэк-нарратор (тёмные сцены) | `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` | — |

## Эмбеддинги (локально, transformers.js — НЕ через OpenRouter)

- Основной: `bge-m3`
- Альтернатива: `multilingual-e5-large`

## Опциональные (не в MVP)

- Роутер тёмных сцен (классификатор): `nvidia/nemotron-3.5-content-safety:free`
- NPC-спавн-хелпер (микромодель): `nvidia/nemotron-3-nano-30b-a3b:free` или `openai/gpt-oss-20b:free`
- Атмосферная музыка (фаза 2+, платно ~$0.04/клип): `google/lyria-3-clip-preview`

## НЕ использовать на игровом тексте (логируют промпты)

- `openrouter/owl-alpha`
- `poolside/laguna-m.1:free`
