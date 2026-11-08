import type { ReactNode, SelectHTMLAttributes } from 'react';
import { Input } from '@/components/ui/pixelact-ui/input';
import { Label } from '@/components/ui/pixelact-ui/label';
import { cn } from '@/lib/utils';

/** A heading in the pixel font, kept small: the pixel font is hard to read at length. */
export function Title({
  as: Tag,
  size = 'md',
  id,
  children,
}: {
  as: 'h1' | 'h2' | 'h3';
  size?: 'lg' | 'md' | 'sm';
  id?: string;
  children: ReactNode;
}) {
  const sizes = { lg: 'text-xl md:text-2xl', md: 'text-base md:text-lg', sm: 'text-sm' };
  return (
    <Tag id={id} className={cn('pixel-font mt-8 first:mt-0 leading-relaxed', sizes[size])}>
      {children}
    </Tag>
  );
}

/** A labelled text field: the label, the pixel input, and a hint tied to it for screen readers. */
export function Field({
  id,
  label,
  hint,
  value,
  onChange,
  type = 'text',
  autoComplete = 'off',
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} className="font-sans! text-sm font-semibold leading-relaxed">
        {label}
      </Label>
      <Input
        id={id}
        name={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        spellCheck={false}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        className="w-full max-w-2xl font-sans! text-base"
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      {hint !== undefined && (
        <p id={`${id}-hint`} className="mt-2 text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** A native select in the pixel look. A native control keeps the keyboard, screen readers, and
 *  the page's strict content policy happy (the library's own select injects inline styles). */
export function PixelSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'box-shadow-margin bg-background p-2 font-sans! text-base text-foreground shadow-(--pixel-box-shadow)',
        className,
      )}
      {...props}
    />
  );
}
