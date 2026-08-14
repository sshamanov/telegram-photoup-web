<script lang="ts">
  export let label: string
  export let min = 0
  export let max = 1
  export let step = 0.01
  export let value: number
  export let display: string | null = null
  export let onChange: (v: number) => void = () => {}
</script>

<label class="slider">
  <span class="label">{label}</span>
  <input
    type="range"
    {min}
    {max}
    {step}
    value={value}
    oninput={(e) => onChange(Number(e.currentTarget.value))}
  />
  <span class="value">{display ?? value.toFixed(2)}</span>
</label>

<style>
  .slider {
    display: grid;
    grid-template-columns: 90px 1fr 72px;
    align-items: center;
    gap: 10px;
  }
  .label {
    font-size: 13px;
    color: var(--muted);
  }
  .value {
    font-size: 13px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
