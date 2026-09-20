import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  requestUrl: vi.fn(),
  normalizePath: (path: string) => path,
  TFile: class TFile {},
}));

import { articleImages, isImage, prepareImage } from '../src/media';
import { requestUrl } from 'obsidian';

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

it('rejects a remote image from HEAD Content-Length before downloading it', async () => {
 const request = vi.mocked(requestUrl);
 request.mockResolvedValueOnce({ status: 200, headers: { 'content-length': String(41 * 1024 * 1024) } } as never);
 const app = {} as never;
 await expect(prepareImage(app, { value: 'https://example.com/large.png', label: 'large' }))
  .rejects.toThrow('40 MB snapshot limit');
 expect(request).toHaveBeenCalledOnce();
 expect(request.mock.calls[0][0]).toMatchObject({ method: 'HEAD', throw: false });
});


it.each(['unsupported', 'failed', 'missing', 'understated'])('still checks downloaded bytes when HEAD is %s', async (scenario) => {
 const request = vi.mocked(requestUrl);request.mockReset();
 if(scenario==='failed')request.mockRejectedValueOnce(new Error('Network error'));
 else request.mockResolvedValueOnce({status:scenario==='unsupported'?405:200,headers:scenario==='missing'?{}:{'content-length':scenario==='unsupported'?String(50*1024*1024):'10'}} as never);
 request.mockResolvedValueOnce({headers:{'content-type':'image/png'},arrayBuffer:new ArrayBuffer(40*1024*1024+1)} as never);
 await expect(prepareImage({} as never,{value:'https://example.com/image.png',label:'Image'})).rejects.toThrow('40 MB snapshot limit');
 expect(request).toHaveBeenCalledTimes(2);
 expect(request.mock.calls[1][0]).toEqual({url:'https://example.com/image.png',throw:true});
});
