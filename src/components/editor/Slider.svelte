<script lang="ts">
  export let label: string
  export let min = 0
  export let max = 1
  export let step = 0.01
  export let value: number
  export let display: string | null = null
  export let onChange: (v: number) => void = () => {}

  $: pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
</script>

<label class="slider">
  <span class="label">{label}</span>
  <input
    type="range"
    {min}
    {max}
    {step}
    {value}
    style={`--pct:${pct}%`}
    oninput={(e) => onChange(Number(e.currentTarget.value))}
  />
  <span class="value">{display ?? value.toFixed(2)}</span>
</label>

<style>
  .slider {
    display: grid;
    grid-template-columns: 100px 1fr 88px;
    align-items: center;
    gap: 16px;
  }
  .label {
    color: var(--muted);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .value {
    text-align: right;
    color: var(--accent-2);
    font-variant-numeric: tabular-nums;
    font-size: 13px;
  }
  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 22px;
    margin: 0;
    background: transparent;
    cursor: pointer;
  }
  input[type='range']::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--accent) var(--pct), var(--border-strong) var(--pct));
  }
  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    margin-top: -6.5px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--bg);
    box-shadow: 0 0 0 1px var(--accent), 0 0 12px rgba(255, 122, 69, 0.4);
  }
  input[type='range']::-moz-range-track {
    height: 3px;
    border-radius: 2px;
    background: var(--border-strong);
  }
  input[type='range']::-moz-range-progress {
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  input[type='range']::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--bg);
  }
</style>
