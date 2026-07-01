import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: 'https://blog.swayam.li',
  integrations: [mdx(),sitemap()],
});
