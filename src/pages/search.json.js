import { getCollection } from 'astro:content';

export async function GET() {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  
  const searchIndex = posts.map(post => ({
    title: post.data.title,
    description: post.data.description || '',
    date: post.data.date,
    slug: post.slug,
    body: post.body
  }));

  return new Response(JSON.stringify(searchIndex), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
