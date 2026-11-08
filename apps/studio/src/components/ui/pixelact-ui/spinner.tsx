import { cn } from '@/lib/utils';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      className={cn('animate-[hourglassFlip_3s_ease-in-out_infinite]', className)}
      {...props}
    >
      <path
        fill="currentColor"
        d="M18 2H6v6h2v2h2v4H8v2H6v6h12v-6h-2v-2h-2v-4h2V8h2zm-2 6h-2v2h-4V8H8V4h8zm-2 6v2h2v4H8v-4h2v-2z"
      />
    </svg>
  );
}

export { Spinner };
