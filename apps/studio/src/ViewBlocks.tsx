import type { Block, View } from '@hero-cloud/presentation';
import { Alert, AlertDescription } from '@/components/ui/pixelact-ui/alert';
import { Title } from './fields.js';

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'paragraph':
      return <p className="my-3 leading-relaxed">{block.text}</p>;
    case 'list':
      return (
        <ul className="my-3 list-disc space-y-1 pl-6">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div className="table-scroll my-3" role="region" tabIndex={0} aria-label="table">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {block.columns.map((column, i) => (
                  <th key={i} scope="col" className="border border-border bg-muted p-2 text-left">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-border p-2 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'code':
      return (
        <pre className="my-3 overflow-x-auto bg-muted p-3 text-sm">
          <code>{block.text}</code>
        </pre>
      );
    case 'callout':
      return (
        <Alert
          font="normal"
          role={block.tone === 'info' ? 'note' : 'alert'}
          variant={block.tone === 'danger' ? 'destructive' : 'default'}
          className={
            block.tone === 'warning' ? 'my-4! bg-warning text-warning-foreground' : 'my-4!'
          }
        >
          <AlertDescription className={block.tone === 'warning' ? 'text-current' : undefined}>
            {block.text}
          </AlertDescription>
        </Alert>
      );
  }
}

/** Draws a renderer-neutral view. Text always goes in as text: it may come from a project. */
export function ViewBlocks({ view }: { view: View }) {
  return (
    <article aria-label={view.title}>
      <Title as="h2">{view.title}</Title>
      {view.sections.map((section) => (
        <section key={section.id}>
          <Title as="h3" size="sm">
            {section.heading}
          </Title>
          {section.blocks.map((block, i) => (
            <BlockView key={i} block={block} />
          ))}
        </section>
      ))}
    </article>
  );
}
