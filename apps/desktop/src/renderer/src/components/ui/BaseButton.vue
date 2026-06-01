<script setup lang="ts">
// Shared button. Content (label and/or material-symbol icon) goes in the slot;
// disabled and other attrs fall through to the native <button>.
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
    size?: 'sm' | 'md' | 'lg'
    block?: boolean
    /** square icon-only button (compact padding, 6px radius) */
    icon?: boolean
    type?: 'button' | 'submit'
  }>(),
  {
    variant: 'primary',
    size: 'md',
    block: false,
    icon: false,
    type: 'button'
  }
)
</script>

<template>
  <button
    :type="type"
    :class="[
      'inline-flex items-center justify-center gap-1 transition-colors active:scale-[0.97] motion-reduce:transform-none disabled:opacity-60 disabled:pointer-events-none',
      icon ? 'p-1.5 rounded-[6px]' : 'rounded-md',
      !icon &&
        (size === 'sm'
          ? 'h-8 px-3 text-sm'
          : size === 'lg'
            ? 'h-10 px-5 text-base'
            : 'h-9 px-4 text-base'),
      block ? 'w-full' : '',
      variant === 'primary'
        ? 'bg-primary text-white hover:bg-primary-hover font-medium'
        : variant === 'secondary'
          ? 'border border-surface-border text-text-main hover:bg-surface-hover font-medium'
          : variant === 'danger'
            ? 'border border-surface-border text-danger hover:bg-danger-soft font-medium'
            : icon
              ? 'text-text-muted hover:text-text-main hover:bg-surface-hover'
              : 'text-text-main hover:bg-surface-hover'
    ]"
  >
    <slot />
  </button>
</template>
