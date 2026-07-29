<script lang="ts">
	import { loadManifest } from '$lib/fonts/builtin';
	import { storeUpload, listUploadedFamilies, type UploadedFamily } from '$lib/fonts/upload';
	import type { FaceKey } from '$lib/fonts/types';
	import type { BuiltinFontManifest } from '$lib/fonts/types';
	import type { FontSlotT } from '$lib/theme/schema';
	import Field from './Field.svelte';

	interface Props {
		label: string;
		slot: FontSlotT;
		/** Reason this slot failed to resolve, if it did (§7.4). */
		failure?: string | null;
		onchange: (slot: FontSlotT) => void;
	}
	let { label, slot, failure = null, onchange }: Props = $props();

	let manifest = $state<BuiltinFontManifest>({});
	let manifestError = $state<string | null>(null);
	let uploads = $state<UploadedFamily[]>([]);
	let uploadError = $state<string | null>(null);
	let googleInput = $state('');
	let busy = $state(false);

	const FACES: FaceKey[] = ['normal', 'bold', 'italics', 'bolditalics'];
	const FACE_LABEL: Record<FaceKey, string> = {
		normal: 'Regular',
		bold: 'Bold',
		italics: 'Italic',
		bolditalics: 'Bold Italic'
	};

	$effect(() => {
		loadManifest()
			.then((m) => (manifest = m))
			.catch((e: unknown) => (manifestError = e instanceof Error ? e.message : String(e)));
		void refreshUploads();
	});

	async function refreshUploads() {
		uploads = await listUploadedFamilies();
	}

	async function upload(files: FileList | null, face: FaceKey) {
		if (!files?.length) return;
		busy = true;
		uploadError = null;
		const family =
			slot.source.kind === 'upload' ? slot.source.family : files[0].name.replace(/\.[^.]+$/, '');
		const result = await storeUpload(files[0], family, face);
		busy = false;
		if (!result.ok) {
			uploadError = result.reason;
			return;
		}
		await refreshUploads();
		onchange({ ...slot, source: { kind: 'upload', hash: result.upload.hash, family } });
	}

	const kind = $derived(slot.source.kind);
	const currentUpload = $derived.by(() => {
		const source = slot.source;
		return source.kind === 'upload' ? uploads.find((u) => u.hash === source.hash) : undefined;
	});
</script>

<div class="picker">
	<div class="head">
		<strong>{label}</strong>
		<select
			aria-label="{label} font source"
			value={kind}
			onchange={(e) => {
				const next = e.currentTarget.value;
				if (next === 'builtin') onchange({ ...slot, source: { kind: 'builtin', id: 'inter' } });
				else if (next === 'google')
					onchange({ ...slot, source: { kind: 'google', family: 'Roboto', weights: [400, 700] } });
				else onchange({ ...slot, source: { kind: 'upload', hash: '', family: 'Uploaded' } });
			}}
		>
			<option value="builtin">Built-in</option>
			<option value="upload">Upload</option>
			<option value="google">Google Fonts (online only, experimental)</option>
		</select>
	</div>

	{#if slot.source.kind === 'builtin'}
		{#if manifestError}
			<p class="error">Font manifest unavailable: {manifestError}</p>
		{/if}
		<Field label="Family">
			<select
				value={slot.source.id}
				onchange={(e) =>
					onchange({ ...slot, source: { kind: 'builtin', id: e.currentTarget.value } })}
			>
				{#each Object.entries(manifest) as [id, entry] (id)}
					<option value={id}>{entry.name} · {entry.category}</option>
				{/each}
			</select>
		</Field>
	{:else if slot.source.kind === 'upload'}
		<p class="hint">TTF or OTF. Validated by magic bytes, stored in this browser only.</p>
		{#each FACES as face (face)}
			<Field label={FACE_LABEL[face]}>
				<input
					type="file"
					accept=".ttf,.otf"
					disabled={busy}
					onchange={(e) => upload(e.currentTarget.files, face)}
				/>
			</Field>
		{/each}
		{#if currentUpload}
			<p class="hint">
				Loaded: {Object.entries(currentUpload.faces)
					.map(([f, n]) => `${FACE_LABEL[f as FaceKey]} (${n})`)
					.join(', ')}
			</p>
		{/if}
		{#if uploadError}<p class="error">{uploadError}</p>{/if}
		{#if uploads.length}
			<Field label="Reuse">
				<select
					value={slot.source.hash}
					onchange={(e) => {
						const hit = uploads.find((u) => u.hash === e.currentTarget.value);
						if (hit)
							onchange({
								...slot,
								source: { kind: 'upload', hash: hit.hash, family: hit.family }
							});
					}}
				>
					<option value="">—</option>
					{#each uploads as u (u.hash)}
						<option value={u.hash}>{u.family}</option>
					{/each}
				</select>
			</Field>
		{/if}
	{:else}
		<p class="hint">Fetched from Google on first use, then cached for offline use.</p>
		<Field label="Family">
			<input
				type="text"
				spellcheck="false"
				value={googleInput || slot.source.family}
				oninput={(e) => (googleInput = e.currentTarget.value)}
				onchange={(e) =>
					onchange({
						...slot,
						source: {
							kind: 'google',
							family: e.currentTarget.value.trim(),
							weights: slot.source.kind === 'google' ? slot.source.weights : [400, 700]
						}
					})}
			/>
		</Field>
		<Field label="Weights" hint="Regular then bold, e.g. 400, 700">
			<input
				type="text"
				spellcheck="false"
				value={slot.source.weights.join(', ')}
				onchange={(e) => {
					const weights = e.currentTarget.value
						.split(',')
						.map((w) => Number(w.trim()))
						.filter((w) => Number.isFinite(w) && w >= 100 && w <= 900);
					if (weights.length && slot.source.kind === 'google')
						onchange({ ...slot, source: { ...slot.source, weights } });
				}}
			/>
		</Field>
	{/if}

	<Field label="Fallback" hint="Used when the source above cannot be resolved">
		<select
			value={slot.fallback}
			onchange={(e) => onchange({ ...slot, fallback: e.currentTarget.value })}
		>
			{#each Object.entries(manifest) as [id, entry] (id)}
				<option value={id}>{entry.name}</option>
			{/each}
		</select>
	</Field>

	{#if failure}
		<p class="error">Unavailable — {failure}. Rendering with {slot.fallback} instead.</p>
	{/if}
</div>

<style>
	.picker {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 8px;
		margin-bottom: 8px;
		background: var(--bg-input);
	}
	.head {
		display: flex;
		gap: 8px;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
	}
	.head select {
		flex: 1;
		min-width: 0;
	}
	.hint {
		margin: 2px 0 6px;
		font-size: 11px;
		color: var(--text-faint);
	}
	.error {
		margin: 4px 0 0;
		font-size: 11px;
		color: var(--error);
	}
</style>
