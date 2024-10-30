import { load as loadEnv } from "loadenv";
import { BskyAgent, PostView } from "npm:@atproto/api";
import dayjs from "npm:dayjs@1.11.11";

await loadEnv();

const identifier = Deno.env.get("IDENTIFIER") ?? '';
const password = Deno.env.get("PASSWORD") ?? '';
const baseUrl = "https://bsky.social";

const agent = new BskyAgent({ service: baseUrl });

const REPEAT_REGEX = /([0-9]{0,5})d([0-9]{0,5})h/;
const DELETE_REGEX = /r([0-9]{0,5})h/

type Post = {
  createdAt: dayjs.Dayjs,
  
  uri: string,
  cid: string,
}

type RepeatPost = {
  type: 'repeat',
  
  lastRepostAt: dayjs.Dayjs,
  
  days: number,
  hours: number
} & Post

type RemovePost = {
  type: 'remove',
  
  hours: number
} & Post

if(!identifier || !password) throw 'Identifier and password cannot be empty!'

let queuePosts: (RepeatPost | RemovePost)[] = [];

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
    
    const posts = postsResponse.data.feed;
    const postsList = Array.from(
      new Map(posts.map(({post}) => [post.uri, post])).values()
    );
    
    const getPostsFromTagRegex = (regex: RegExp) => postsList.map((post): [PostView, any] | null => {

      for (const facet of post.record?.facets ?? [])
        for (const feature of facet.features)
          if (feature["$type"] === "app.bsky.richtext.facet#tag") {
            const match = new RegExp(regex).exec(feature.tag);
            if (match) return [post, match];
          }
      return null;
    }).filter(e => e !== null);
    
    const postsToRePost = getPostsFromTagRegex(REPEAT_REGEX).map<RepeatPost>(([post, match]) => ({
      type: 'repeat',
      uri: post.uri,
      cid: post.cid,
      
      createdAt: dayjs(post.record.createdAt),
      lastRepostAt: dayjs(post.record.createdAt),
      days: parseInt(match?.[1] ?? '-1'),
      hours: parseInt(match?.[2] ?? '-1'),
    }))
    const postsToRemove = getPostsFromTagRegex(DELETE_REGEX).map<RemovePost>(([post, match]) => ({
      type: 'remove',
      uri: post.uri,
      cid: post.cid,
      
      hours: parseInt(match?.[1] ?? '-1'),
      
      createdAt: dayjs(post.record.createdAt),
    }))
    
    const toAddPosts = [...postsToRePost, ...postsToRemove]
      .filter(post => !queuePosts.find(qPost => qPost.uri === post.uri && qPost.type === post.type))
      
    queuePosts.push(...toAddPosts)
    
    const repeatCount = queuePosts.filter(p => p.type === 'repeat').length;
    const removeCount = queuePosts.filter(p => p.type === 'remove').length
    
    console.log(`queue posts - repeat (${repeatCount}) - remove (${removeCount})`)
    for (const post of queuePosts) {
      
      if(post.type === 'repeat') {
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
      if(post.type === 'remove') {
        const endDate = post.createdAt.add(post.hours, 'hours');
        if(endDate.isBefore(dayjs())) {
          console.log(`- removed ${post.uri}!`)
          try {
            await agent.deletePost(post.uri);
          } catch (e) {}
          queuePosts = queuePosts.filter(qPost => qPost.uri !== post.uri);
        }
      }
    }
  } catch (error) {
    console.error("Error logging in or retrieving posts:", error);
  }
  
}

Deno.cron('Repeat me', '*/15 * * * *', loopFunction);
loopFunction()