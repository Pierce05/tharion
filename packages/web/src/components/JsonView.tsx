import { highlightJson } from '../lib/format';

export function JsonView({ value }: { value: unknown }) {
  return <pre dangerouslySetInnerHTML={{ __html: highlightJson(value) }} />;
}