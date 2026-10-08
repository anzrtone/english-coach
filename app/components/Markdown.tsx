import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Headings are scaled down so a model-emitted "# Title" reads as a bold line
// inside a chat bubble instead of a page title. Raw HTML is never rendered.
const components: Components = {
  h1: ({ children }) => <h3 className="md-h md-h1">{children}</h3>,
  h2: ({ children }) => <h3 className="md-h md-h2">{children}</h3>,
  h3: ({ children }) => <h4 className="md-h md-h3">{children}</h4>,
  h4: ({ children }) => <h5 className="md-h md-h4">{children}</h5>,
  h5: ({ children }) => <h6 className="md-h md-h4">{children}</h6>,
  h6: ({ children }) => <h6 className="md-h md-h4">{children}</h6>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="md-table-wrap">
      <table>{children}</table>
    </div>
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
