<script lang="ts">
	interface Props {
		onclose: () => void;
	}
	let { onclose }: Props = $props();

	type Row = { model: string; rec?: boolean; price: string; ctx: string; per1k: string; light: string; active: string; note: string };
	const rows: Row[] = [
		{ model: 'DeepSeek V4 Flash', price: '$0.14 / $0.28', ctx: '1M', per1k: '~$1.1', light: '~$0.5', active: '~$3', note: 'самый дешёвый; разрешительный к тёмному; русский норм, проза проще; кэш-хит ~$0.0028/M' },
		{ model: 'DeepSeek V3.2', price: '$0.23 / $0.34', ctx: '131K', per1k: '~$1.7', light: '~$0.8', active: '~$5', note: 'то же, чуть богаче; function calling + кэш' },
		{ model: 'Qwen3.6 Plus', rec: true, price: '$0.325 / $1.95', ctx: '1M', per1k: '~$3.5', light: '~$1.8', active: '~$10', note: 'лучший русский за свои деньги; 1M; tools; кэш — рекомендованный дефолт' },
		{ model: 'Gemini 3 Flash', price: '$0.50 / $3', ctx: '1M', per1k: '~$5.4', light: '~$2.7', active: '~$16', note: 'быстрый, хороший русский, 1M, авто-кэш' },
		{ model: 'Gemini 3.5 Flash', price: '$1.50 / $9', ctx: '1M', per1k: '~$16.2', light: '~$8', active: '~$49', note: 'новее/дороже Flash; брать, если 3 Flash не хватает по качеству' },
		{ model: 'Gemini 3.1 Pro', price: '$2 / $12', ctx: '1M', per1k: '~$21.6', light: '~$11', active: '~$65', note: 'сильный всё-раунд, отличный русский, 1M' },
		{ model: 'Claude Sonnet 4.6', price: '$3 / $15', ctx: '1M', per1k: '~$30', light: '~$15', active: '~$90', note: 'лучшая проза/следование инструкциям; чаще стерилизует тёмное → нужен фоллбэк-профиль' },
		{ model: 'Claude Opus 4.8', price: '$5 / $25', ctx: '1M', per1k: '~$50', light: '~$25', active: '~$150', note: 'топ-качество; платить за каждый ход избыточно' },
		{ model: 'GPT-5.5', price: '$5 / $30', ctx: '1M', per1k: '~$54', light: '~$27', active: '~$162', note: 'флагман OpenAI; дорого для нарратора' }
	];
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="panel" role="dialog" aria-label="Справка: платные модели" aria-modal="true">
	<header>
		<h2>Платные модели на роль Ведущего</h2>
		<button class="close" onclick={onclose} aria-label="Закрыть">✕</button>
	</header>

	<p class="status mono">
		Справочный материал, не часть ТЗ. Снимок цен <b>июнь 2026</b> — цены и линейки
		быстро меняются, перед решением сверять на <code>openrouter.ai</code>.
	</p>
	<p class="lead">
		Роль Ведущего — главный творческий вызов каждого хода (проза + операции). Нужны:
		сильный <b>русский</b>, хорошая проза/ролеплей, надёжный function calling, длинный
		контекст, спокойное отношение к тёмным сценам. Это касается <b>только нарратора</b>;
		валидатор и режиссёр могут оставаться на free-моделях.
	</p>

	<h3>1. Как считается стоимость</h3>
	<p>Один ход нарратора под архитектуру v1.2:</p>
	<ul>
		<li><b>Вход ≈ 6 000 токенов</b> — системный промпт + правила + scoped-контекст + tool-схема (в насыщенных сценах до 8–10k).</li>
		<li><b>Выход ≈ 800 токенов</b> — проза хода + операции.</li>
	</ul>
	<pre class="formula mono">ход = 0.006 × (цена входа $/M) + 0.0008 × (цена выхода $/M)</pre>
	<p class="fine">Сверху — комиссия OpenRouter 5,5% при пополнении (не пер-токен). «Свет» = 500 ходов/мес, «Актив» = 3000 ходов/мес. 1 сессия ≈ 30–80 ходов.</p>

	<h3>2. Сравнение кандидатов <span class="fine">(цены июнь 2026, $/M вход·выход)</span></h3>
	<div class="table-wrap">
		<table>
			<thead>
				<tr><th>Модель</th><th>Вход / Выход</th><th>Контекст</th><th>~$/1000 ходов</th><th>Свет ~$/мес</th><th>Актив ~$/мес</th><th>Комментарий</th></tr>
			</thead>
			<tbody>
				{#each rows as r (r.model)}
					<tr class:rec={r.rec}>
						<td class="m">{r.model}{#if r.rec}<span class="star" title="рекомендованный дефолт"> ★</span>{/if}</td>
						<td class="mono">{r.price}</td>
						<td class="mono">{r.ctx}</td>
						<td class="mono">{r.per1k}</td>
						<td class="mono">{r.light}</td>
						<td class="mono">{r.active}</td>
						<td class="note">{r.note}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="fine">Источники: страницы моделей OpenRouter и агрегаторы (betonai, ofox, morphllm, pricepertoken, bifrost), июнь 2026. Числа $/1000 ходов и $/мес — расчёт по формуле раздела 1.</p>

	<h3>3. Рекомендации по приоритету</h3>
	<ul class="recs">
		<li><b>Баланс под русскоязычную игру (дефолт): Qwen3.6 Plus.</b> Стабильно сильнее всех в русском; 1M контекста с запасом; tools и кэш. ~$2–10/мес.</li>
		<li><b>Максимальная проза: Claude Sonnet 4.6.</b> Лучшее письмо и следование инструкциям, но чаще смягчает тёмные сцены — под него <b>обязателен фоллбэк-профиль</b> (Venice/DeepSeek). ~$15–90/мес. Opus 4.8 ещё лучше, но дорого на каждый ход.</li>
		<li><b>Золотая середина: Gemini 3.1 Pro</b> (отличный русский, 1M, ~$11–65/мес) или дешёвый <b>Gemini 3 Flash</b> (~$3–16/мес).</li>
		<li><b>Дёшево + спокойно к тёмному: DeepSeek V3.2 / V4 Flash.</b> Копейки (~$0.5–5/мес), почти не упирается в отказы; суше проза и слабее русский. Хороший кандидат на <b>фоллбэк-нарратора тёмных сцен</b>.</li>
	</ul>

	<h3>4. Комментарии и оговорки</h3>
	<ul class="caveats">
		<li><b>Качество русского и «готовность к тёмному» в ценниках не отражены</b> — это качественные оценки. Перед закреплением прогнать 2–3 реальные сцены (одну тёмную) на Qwen3.6 Plus, Gemini 3 Flash и Sonnet 4.6.</li>
		<li><b>Кэширование сильно режет вход.</b> ~2k токенов промпта стабильны; кэш-вход за 10–20% цены → минус ~25% к входу. У DeepSeek кэш почти бесплатен. Реальные счета ниже таблицы.</li>
		<li><b>Это только нарратор.</b> Валидатор (Gemma/gpt-oss) и режиссёр могут оставаться на free.</li>
		<li><b>Комиссия OpenRouter</b> — фиксированные 5,5% при пополнении, без пер-токенной накрутки.</li>
		<li><b>Доступность Claude:</b> топовый тир «Mythos/Fable» приостановлен по экспортным ограничениям (с 12.06.2026); доступны Sonnet 4.6 / Opus 4.8 / Haiku 4.5.</li>
		<li><b>Гибрид как стратегия:</b> дешёвая модель основным нарратором + эскалация на премиум в ключевых сценах. Разброс цен 30–50× оставляет простор для экономии.</li>
	</ul>

	<h3>5. Быстрый пересчёт под себя</h3>
	<ol>
		<li>Прикинь средний размер промпта (вход) и ответа (выход) по реальным логам (раздел 22 ТЗ это покажет).</li>
		<li>Подставь в формулу: <code class="mono">ход = (вход/1e6)×цена_входа + (выход/1e6)×цена_выхода</code>.</li>
		<li>Умножь на число ходов в месяц, добавь 5,5%.</li>
		<li>Если включён кэш — уменьши входную часть на ~20–25% (для DeepSeek — сильнее).</li>
	</ol>

	<p class="footer mono">Справочный материал. Цены — июнь 2026, проверять перед оплатой. Полный текст — <code>docs/reference_paid_narrator_models.md</code>.</p>
</div>

<style>
	.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 10; }
	.panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(96vw, 1100px); max-height: 92vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.2rem clamp(1.2rem, 3vw, 2.2rem) 1.6rem; z-index: 11; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
	header { display: flex; justify-content: space-between; align-items: center; margin-bottom: .8rem; position: sticky; top: -1.2rem; background: var(--surface); padding-top: .2rem; }
	header h2 { margin: 0; font-size: 1.2rem; }
	.close { background: none; border: none; color: var(--text-dim); font-size: 1.1rem; }
	h3 { font-size: .98rem; margin: 1.4rem 0 .5rem; color: var(--accent); }
	h3 .fine { color: var(--text-dim); font-weight: normal; }
	.status { font-size: .76em; color: var(--text-dim); background: var(--surface-raised); border: 1px solid var(--border); border-radius: 8px; padding: .55rem .7rem; line-height: 1.5; }
	.status code, code { font-family: var(--font-mono); background: var(--ink-900); padding: .05rem .3rem; border-radius: 4px; font-size: .92em; }
	.lead { font-size: .92em; line-height: 1.55; color: var(--text); }
	p { margin: .5rem 0; line-height: 1.5; font-size: .9em; }
	ul, ol { margin: .4rem 0; padding-left: 1.2rem; }
	li { margin: .35rem 0; line-height: 1.5; font-size: .88em; }
	.formula { background: var(--ink-900); border: 1px solid var(--border); border-radius: 8px; padding: .7rem .8rem; font-size: .82em; overflow-x: auto; white-space: pre; color: var(--accent); }
	.fine { font-size: .78em; color: var(--text-dim); }
	.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
	table { border-collapse: collapse; width: 100%; min-width: 680px; font-size: .8em; }
	th, td { text-align: left; padding: .45rem .55rem; border-bottom: 1px solid var(--border); vertical-align: top; }
	th { color: var(--text-dim); font-weight: 600; white-space: nowrap; position: sticky; top: 0; background: var(--surface-raised); }
	td.m { font-weight: 600; white-space: nowrap; }
	td.note { color: var(--text-dim); min-width: 200px; }
	tr.rec td { background: color-mix(in srgb, var(--accent) 10%, transparent); }
	tr.rec td.m { color: var(--accent); }
	.star { color: var(--accent); }
	.mono { font-family: var(--font-mono); }
	.footer { margin-top: 1.4rem; padding-top: 1rem; border-top: 1px solid var(--border); font-size: .74em; color: var(--text-dim); line-height: 1.5; }
</style>
