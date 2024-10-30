import { load as loadEnv } from "loadenv";
import { BskyAgent } from "npm:@atproto/api";
import dayjs from "npm:dayjs@1.11.11";

await loadEnv();

const identifier = Deno.env.get("IDENTIFIER") ?? '';
const password = Deno.env.get("PASSWORD") ?? '';
const baseUrl = "https://bsky.social";

const agent = new BskyAgent({ service: baseUrl });

type Post = {
  createdAt: dayjs.Dayjs,
  lastRepostAt: dayjs.Dayjs,
  
  uri: string,
  cid: string,
  days: number,
  hours: number
}

if(!identifier || !password) throw 'Identifier and password cannot be empty!'

let queuePosts: Post[] = [];

const loopFunction = async () => {
  try {
    const loginResponse = await agent.login({
      identifier,
      password,
    });
    
    if (!loginResponse.success)
      throw new Error(`Failed to log in: ${loginResponse.error}`);
    
    
    const postsResponse = await agent.getAuthorFeed({
      actor: loginResponse.data.did,
    });
    
    const timeRegex = /([0-9]{0,5})d([0-9]{0,5})h/
    
    const posts = postsResponse.data.feed;
    const postsToRePost = Array.from(
      new Map(posts.map(({post}) => [post.uri, post])).values()
    ).map((post) => {
      let match;
      for (const facet of post.record?.facets ?? [])
        for (const feature of facet.features)
          if(feature["$type"] === "app.bsky.richtext.facet#tag")  {
            match = new RegExp(timeRegex).exec(feature.tag);
            if(match) break;
          }
      return {
        createdAt: dayjs(post.record.createdAt),
        lastRepostAt: dayjs(post.record.createdAt),
        uri: post.uri,
        cid: post.cid,
        days: parseInt(match?.[1] ?? '-1'),
        hours: parseInt(match?.[2] ?? '-1'),
      }
    }).filter(post => post.days > 0 && post.hours > 0)
      .filter(post => !queuePosts.find(qPost => qPost.uri === post.uri))
    
    queuePosts.push(...postsToRePost)
    
    console.log(`queue posts (${queuePosts.length})`)
    for (const post of queuePosts) {
      const endDate = post.createdAt.add(post.days, 'day');
      const nextRepost = post.lastRepostAt.add(post.hours, 'hours')
      
      //can repost
      if(nextRepost.isBefore(dayjs())) {
        try {
          await agent.deleteRepost(post.uri);
        } catch (e) {}
        try {
          await agent.repost(post.uri, post.cid);
        } catch (e) {
          //post doesnt exist anymore
          queuePosts = queuePosts.filter(qPost => qPost.uri !== post.uri);
        }
        console.log(`- reposted ${post.uri}!`)
      }
      
      if(endDate.isBefore(dayjs()))
        queuePosts = queuePosts.filter(qPost => qPost.uri !== post.uri);
    }
  } catch (error) {
    console.error("Error logging in or retrieving posts:", error);
  }
  
}

Deno.cron('Repeat me', '*/15 * * * *', loopFunction);
loopFunction()