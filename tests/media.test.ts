import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  requestUrl: vi.fn(),
  normalizePath: (path: string) => path,
  TFile: class TFile {},
}));

import { articleImages, isImage } from '../src/media';

describe('article image extraction', () => {
  it('extracts remote Markdown images with labels and source lines', () => {
    const text = 'Intro\n\n![A chart](https://example.com/chart.webp "source")';
    expect(articleImages(text, 'notes/article.md')).toEqual([{
      value: 'https://example.com/chart.webp',
      label: 'A chart',
      articlePath: 'notes/article.md',
      articleLine: 2,
    }]);
  });

  it('extracts Obsidian wiki filenames and aliases', () => {
    expect(articleImages('![[assets/figure.png|Figure]]', 'notes/article.md')).toEqual([{
      value: 'assets/figure.png',
      label: 'Figure',
      articlePath: 'notes/article.md',
      articleLine: 0,
    }]);
  });

  it('recognizes image extensions while ignoring URL fragments and queries', () => {
    expect(isImage('figure.PNG?size=small')).toBe(true);
    expect(isImage('document.md')).toBe(false);
    expect(articleImages('![diagram](https://example.com/diagram.svg#view)', 'a.md')).toHaveLength(1);
  });
});

it('keeps balanced parentheses in remote image URLs',()=>{
 expect(articleImages('![Chart](https://example.com/chart_(final).png)','Article.md')[0].value).toBe('https://example.com/chart_(final).png');
});
