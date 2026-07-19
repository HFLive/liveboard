import { ArrowUpDown } from "lucide-react";

type SortOption<T extends string> = {
  value: T;
  label: string;
};

type SortIconSelectProps<T extends string> = {
  value: T;
  options: readonly SortOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
};

export function SortIconSelect<T extends string>({
  value,
  options,
  onChange,
  className = "",
  ariaLabel = "排序",
}: SortIconSelectProps<T>) {
  const currentLabel =
    options.find((option) => option.value === value)?.label ?? ariaLabel;

  return (
    <label
      className={`sort-icon-control ${className}`.trim()}
      title={`${ariaLabel}：${currentLabel}`}
    >
      <ArrowUpDown aria-hidden="true" />
      <span>{currentLabel}</span>
      <select
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
