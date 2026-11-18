import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

const SITE = 'https://schluss.co.za';

export interface SeoInput {
  title: string;
  description: string;
  path: string;
  image?: string | null;
  type?: 'website' | 'product';
  jsonLd?: object | object[];
  noindex?: boolean;
}

/** Page titles, meta descriptions, Open Graph, canonical URL and JSON-LD – rendered on the server. */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private title = inject(Title);
  private meta = inject(Meta);
  private doc = inject(DOCUMENT);

  set(s: SeoInput) {
    const full = s.title.includes('SCHLUSS') ? s.title : `${s.title} – SCHLUSS`;
    const url = SITE + s.path;
    const image = s.image ? (s.image.startsWith('http') ? s.image : SITE + s.image) : `${SITE}/brand/schluss-logo-dark.png`;
    this.title.setTitle(full);
    const tags: [string, string, 'name' | 'property'][] = [
      ['description', s.description, 'name'],
      ['robots', s.noindex ? 'noindex, nofollow' : 'index, follow', 'name'],
      ['og:title', full, 'property'],
      ['og:description', s.description, 'property'],
      ['og:url', url, 'property'],
      ['og:type', s.type === 'product' ? 'product' : 'website', 'property'],
      ['og:site_name', 'SCHLUSS', 'property'],
      ['og:image', image, 'property'],
      ['twitter:card', 'summary_large_image', 'name'],
    ];
    for (const [key, content, attr] of tags) this.meta.updateTag({ [attr]: key, content } as never);

    let link = this.doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.doc.createElement('link');
      link.rel = 'canonical';
      this.doc.head.appendChild(link);
    }
    link.href = url;

    this.doc.head.querySelectorAll('script[data-seo]').forEach((n) => n.remove());
    if (s.jsonLd) {
      const script = this.doc.createElement('script');
      script.type = 'application/ld+json';
      script.setAttribute('data-seo', '');
      script.textContent = JSON.stringify(s.jsonLd).replace(/</g, '\\u003c');
      this.doc.head.appendChild(script);
    }
  }
}

export const ORG_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'SCHLUSS',
  url: SITE,
  logo: `${SITE}/brand/schluss-logo-light.png`,
  slogan: 'The last piece of the puzzle',
};
