---
title: "Message"
seoTitle: "Message class in the TypeScript client"
description: Reference for the Message class, its factory methods and all 12 content block types in the 10xGraph TypeScript client.
section: Reference
group: "TypeScript client"
order: 480
label: "Message"
updated: "2026-10-08"
---

`Message` is the data model the 10xGraph TypeScript client uses for every message in a conversation: user input, assistant replies, system prompts, tool calls and tool results. Each message holds a role and an array of typed content blocks. This page lists the class, its factory methods and every block type.

## Import

```ts
import {
  Message,
  TextBlock,
  ImageBlock,
  AudioBlock,
  VideoBlock,
  DocumentBlock,
  DataBlock,
  ToolCallBlock,
  RemoteToolCallBlock,
  ToolResultBlock,
  ReasoningBlock,
  AnnotationBlock,
  ErrorBlock,
  MediaRef,
  AnnotationRef,
  TokenUsages,
} from '10xgraph-client';
```

---

## `Message` class

```ts
class Message {
  message_id: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: ContentBlock[];
  delta: boolean;
  tools_calls?: Record<string, any>[];
  timestamp: number;
  metadata: Record<string, any>;
  usages?: TokenUsages;
  raw?: Record<string, any>; // never set on messages the REST API returns

  constructor(
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: ContentBlock[],
    message_id?: string | null
  );
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `message_id` | `string \| null` | Message ID. Defaults to `null` when you create a message; leave it `null` for new messages. |
| `role` | `'user' \| 'assistant' \| 'system' \| 'tool'` | Who produced this message. |
| `content` | `ContentBlock[]` | Array of content blocks. A single message can have multiple blocks (e.g. text + image). |
| `delta` | `boolean` | `true` when this message is a streaming partial update rather than a final message. Set on messages the server streams back. |
| `tools_calls` | `Record<string, any>[]` | Raw tool call array from the underlying LLM response. Populated by the server; you do not set it. |
| `timestamp` | `number` | Unix timestamp in milliseconds when the message was created. Defaults to `Date.now()` at construction time. |
| `metadata` | `Record<string, any>` | Arbitrary key-value metadata you can attach to messages. |
| `usages` | `TokenUsages` | Token usage information returned by the LLM, when the server provides it. |
| `raw` | `Record<string, any>` | The raw LLM response object, when present. Useful for debugging. |

---

## Static factory methods

### `Message.text_message(content, role?, message_id?)`

The most common way to create a message. Creates a `Message` with a single `TextBlock`.

```ts
const userMsg = Message.text_message('What is the capital of France?');
// role defaults to 'user'

const systemMsg = Message.text_message(
  'You are a helpful geography tutor.',
  'system'
);
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `content` | `string` | none | The text content. |
| `role` | `'user' \| 'assistant' \| 'system' \| 'tool'` | `'user'` | The role for the message. |
| `message_id` | `string \| null` | `null` | Optional message ID. Use `null` to let the server assign one. |

### `Message.tool_message(content, message_id?, meta?)`

Creates a `tool` role message containing `ToolResultBlock` instances. The `message_id` defaults to `null` and `meta` (stored in `metadata`) to `{}`. You rarely build these by hand: when you use remote tools the client creates them for you.

```ts
const toolResult = Message.tool_message([
  new ToolResultBlock({
    call_id: 'call_abc123',
    output: { result: 42 },
    status: 'completed',
    is_error: false,
  }),
]);
```

### `Message.withImage(text, imageUrl, role?)`

Creates a `user` message containing a `TextBlock` followed by an `ImageBlock`. The image is referenced by URL, so pass either an `http(s)` URL the server can fetch or a `data:` URI with inline base64.

```ts
const msg = Message.withImage('Describe this', 'https://example.com/photo.jpg');
const inline = Message.withImage('Describe this', 'data:image/png;base64,iVBORw0...');
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `text` | `string` | none | The prompt that accompanies the image. |
| `imageUrl` | `string` | none | URL or `data:` URI. Stored as `MediaRef` with `kind: 'url'`. |
| `role` | `'user' \| 'assistant' \| 'system'` | `'user'` | Role for the message. Note there is no `'tool'` option here. |

To attach an image you uploaded through `client.uploadFile()`, use `Message.withFile()` instead. It builds a `file_id` reference to the uploaded file.

### `Message.withFile(text, fileId, mimeType?, role?)`

Creates a message containing a `TextBlock` plus one media block referencing an uploaded file by id. The block type is picked from `mimeType`:

| `mimeType` starts with | Block created |
|---|---|
| `image/` | `ImageBlock` |
| `audio/` | `AudioBlock` |
| `video/` | `VideoBlock` |
| anything else, or omitted | `DocumentBlock` |

```ts
const upload = await client.uploadFile(pdfFile);
const msg = Message.withFile('Summarize this PDF', upload.data.file_id, 'application/pdf');
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `text` | `string` | none | The prompt that accompanies the file. |
| `fileId` | `string` | none | `file_id` from `client.uploadFile()` (`response.data.file_id`). |
| `mimeType` | `string` | `undefined` | Used to select the block type and stored on the `MediaRef`. Omitting it produces a `DocumentBlock`. |
| `role` | `'user' \| 'assistant' \| 'system'` | `'user'` | Role for the message. |

Pass the real MIME type. Uploading a PNG and omitting `mimeType` produces a `DocumentBlock`, which is not what a vision model expects.

### `Message.multimodal(blocks, role?)`

Creates a message from an arbitrary array of content blocks. Use it when the shape does not fit `withImage` or `withFile`: several images at once, an image between two pieces of text, or a mix of URL and `file_id` references.

```ts
const msg = Message.multimodal([
  new TextBlock('Which of these two rooms is brighter?'),
  new ImageBlock(new MediaRef('url', 'https://example.com/a.jpg')),
  new ImageBlock(new MediaRef('url', 'https://example.com/b.jpg')),
]);
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `blocks` | `ContentBlock[]` | none | Blocks in the order the model should see them. |
| `role` | `'user' \| 'assistant' \| 'system'` | `'user'` | Role for the message. |

---

## Instance methods

### `text()`

Flattens the message's content down to a single string. `TextBlock` blocks contribute their `text`; `ToolResultBlock` blocks contribute their `output` (stringified with `JSON.stringify` when it is not already a string). Every other block type contributes an empty string, so an image-only message returns `''`.

```ts
const answer = result.messages.at(-1)?.text();
```

This is the method to use when rendering a reply, including for streaming deltas.

### `attach_media(media, as_type)`

Appends one media block to an existing message's `content` array, in place. Returns nothing.

```ts
const msg = Message.text_message('Compare these two charts');

// firstId and secondId are file_id values returned by client.uploadFile()
msg.attach_media(new MediaRef('file_id', undefined, firstId, undefined, 'image/png'), 'image');
msg.attach_media(new MediaRef('file_id', undefined, secondId, undefined, 'image/png'), 'image');
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `media` | `MediaRef` | The reference to attach. |
| `as_type` | `'image' \| 'audio' \| 'video' \| 'document'` | Which block class to wrap it in. Any other value throws `Unsupported media type: <value>`. |

The `MediaRef` constructor is positional, `(kind, url, file_id, data_base64, mime_type, ...)`, so a `file_id` reference needs `undefined` in the `url` slot. Assigning the fields by name is easier to read:

```ts
const media = new MediaRef('file_id');
media.file_id = upload.data.file_id;
media.mime_type = upload.data.mime_type;
msg.attach_media(media, 'image');
```

---

## `ContentBlock` union type

The `content` field of a `Message` is an array of `ContentBlock` values. Each block has a `type` discriminant field. The full union is:

```ts
type ContentBlock =
  | TextBlock
  | ImageBlock
  | AudioBlock
  | VideoBlock
  | DocumentBlock
  | DataBlock
  | ToolCallBlock
  | RemoteToolCallBlock
  | ToolResultBlock
  | ReasoningBlock
  | AnnotationBlock
  | ErrorBlock;
```

---

## Block types

### `TextBlock`

Plain text content.

```ts
class TextBlock {
  type: 'text';
  text: string;
  annotations: AnnotationRef[];
}
```

```ts
const block = new TextBlock('Hello, world!');
```

| Field | Type | Description |
|---|---|---|
| `type` | `'text'` | Discriminant. Always `'text'`. |
| `text` | `string` | The text content. |
| `annotations` | `AnnotationRef[]` | Optional citation or note annotations appended to this block. |

---

### `ImageBlock`

An image attached to a message.

```ts
class ImageBlock {
  type: 'image';
  media: MediaRef;
  alt_text?: string;
  bbox?: number[];
}
```

```ts
const block = new ImageBlock(
  new MediaRef('url', 'https://example.com/photo.jpg'),
  'A photo of a cat'
);
```

| Field | Type | Description |
|---|---|---|
| `type` | `'image'` | Discriminant. |
| `media` | `MediaRef` | Reference to the image data. |
| `alt_text` | `string` | Accessible alternative text. |
| `bbox` | `number[]` | Optional bounding box `[x, y, w, h]` within a parent image. |

---

### `AudioBlock`

An audio clip attached to a message.

```ts
class AudioBlock {
  type: 'audio';
  media: MediaRef;
  transcript?: string;
  sample_rate?: number;
  channels?: number;
}
```

| Field | Type | Description |
|---|---|---|
| `media` | `MediaRef` | Reference to the audio data. |
| `transcript` | `string` | Optional pre-computed transcript of the audio. |
| `sample_rate` | `number` | Sample rate in Hz. |
| `channels` | `number` | Number of audio channels (1 = mono, 2 = stereo). |

---

### `VideoBlock`

A video clip attached to a message.

```ts
class VideoBlock {
  type: 'video';
  media: MediaRef;
  thumbnail?: MediaRef;
}
```

---

### `DocumentBlock`

A document (PDF, DOCX, etc.) attached to a message.

```ts
class DocumentBlock {
  type: 'document';
  media: MediaRef;
  pages?: number[];
  excerpt?: string;
}
```

| Field | Type | Description |
|---|---|---|
| `pages` | `number[]` | Which pages of the document are relevant (1-indexed). |
| `excerpt` | `string` | Optional extracted text excerpt from the document. |

---

### `DataBlock`

Raw binary or structured data encoded as base64 or referenced via `MediaRef`.

```ts
class DataBlock {
  type: 'data';
  mime_type: string;
  data_base64?: string;
  media?: MediaRef;
}
```

---

### `ToolCallBlock`

Represents a tool/function call made by the assistant. Populated by the server; you typically do not create these manually.

```ts
class ToolCallBlock {
  type: 'tool_call';
  id: string;
  name: string;
  args: Record<string, any>;
  tool_type?: string;
}
```

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique ID for this tool call (used to match with `ToolResultBlock.call_id`). |
| `name` | `string` | Name of the tool to call. |
| `args` | `Record<string, any>` | Arguments to pass to the tool function. |
| `tool_type` | `string` | Optional tool type tag (e.g. `'mcp'`, `'function'`). |

---

### `RemoteToolCallBlock`

Like `ToolCallBlock` but specifically for tools that execute on the client side (browser). When the server needs the client to run a tool, it returns a message containing `RemoteToolCallBlock` entries. The client's `invoke()` detects these, runs the registered handlers, and sends the results back.

```ts
class RemoteToolCallBlock {
  type: 'remote_tool_call';
  id: string;
  name: string;
  args: Record<string, any>;
  tool_type: string; // always 'remote'
}
```

You do not create these manually. They arrive from the server inside `invoke()` responses.

---

### `ToolResultBlock`

The result of executing a tool call. When using remote tools the client creates these automatically. You only need to construct them manually if you are building custom tool-loop logic.

```ts
class ToolResultBlock {
  type: 'tool_result';
  call_id: string;
  output: any;
  is_error: boolean;
  status?: 'completed' | 'failed';
}

// Constructor takes an object:
new ToolResultBlock({
  call_id: 'call_abc123',
  output: { temperature: 22.5 },
  status: 'completed',
  is_error: false,
})
```

| Field | Type | Description |
|---|---|---|
| `call_id` | `string` | Must match the `id` of the corresponding `ToolCallBlock` or `RemoteToolCallBlock`. |
| `output` | `any` | The return value of the tool function. Can be any JSON-serialisable value. |
| `is_error` | `boolean` | Set to `true` when the tool execution failed. |
| `status` | `'completed' \| 'failed'` | Status signal sent back to the server. |

---

### `ReasoningBlock`

Extended-thinking / chain-of-thought reasoning steps emitted by models that support it (for example Claude models with extended thinking).

```ts
class ReasoningBlock {
  type: 'reasoning';
  summary: string;
  details?: string[];
}
```

| Field | Type | Description |
|---|---|---|
| `summary` | `string` | Short summary of the reasoning step. |
| `details` | `string[]` | Optional detailed reasoning steps. |

---

### `AnnotationBlock`

Citations or notes appended to message content.

```ts
class AnnotationBlock {
  type: 'annotation';
  kind: 'citation' | 'note';
  refs: AnnotationRef[];
  spans?: [number, number][];
}
```

| Field | Type | Description |
|---|---|---|
| `kind` | `'citation' \| 'note'` | Whether this is a citation to a source or an inline note. |
| `refs` | `AnnotationRef[]` | List of sources or note references. |
| `spans` | `[number, number][]` | Character offset spans within `TextBlock.text` that this annotation covers. |

---

### `ErrorBlock`

Represents an error that occurred during graph execution, embedded in a message.

```ts
class ErrorBlock {
  type: 'error';
  message: string;
  code?: string;
  data?: Record<string, any>;
}
```

---

## Helper types

### `MediaRef`

A reference to a media file. Supports three kinds: an external URL, an uploaded `file_id`, or inline base64 data.

```ts
class MediaRef {
  kind: 'url' | 'file_id' | 'data';
  url?: string;               // when kind = 'url'
  file_id?: string;           // when kind = 'file_id'
  data_base64?: string;       // when kind = 'data'
  mime_type?: string;
  size_bytes?: number;
  sha256?: string;
  filename?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  page?: number;
}
```

**Create a URL reference:**

```ts
const media = new MediaRef('url', 'https://example.com/image.png');
media.mime_type = 'image/png';
```

**Create a file_id reference (after uploading):**

```ts
const uploaded = await client.uploadFile(file);
const media = new MediaRef('file_id');
media.file_id = uploaded.data.file_id;
media.mime_type = uploaded.data.mime_type;
```

---

### `AnnotationRef`

A reference to a source or note target.

```ts
class AnnotationRef {
  url?: string;
  file_id?: string;
  page?: number;
  index?: number;
  title?: string;
}
```

---

### `TokenUsages`

LLM token usage statistics attached to assistant messages.

```ts
class TokenUsages {
  completion_tokens: number;
  prompt_tokens: number;
  total_tokens: number;
  reasoning_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  image_tokens?: number;
  audio_tokens?: number;
}
```

---

## Complete example

```ts
import {
  TenxGraphClient,
  Message,
  TextBlock,
  ImageBlock,
  MediaRef,
} from '10xgraph-client';

// Connect to a running 10xGraph API server
const client = new TenxGraphClient({ baseUrl: 'http://localhost:8000' });

// 1. Simple text message
const greeting = Message.text_message('Hello!');

// 2. Message with mixed text and image
const multimodal = new Message('user', [
  new TextBlock('What is in this image?'),
  new ImageBlock(
    new MediaRef('url', 'https://example.com/photo.jpg'),
    'A street photo'
  ),
]);

// 3. System prompt
const system = Message.text_message(
  'You are a helpful assistant. Be concise.',
  'system'
);

// 4. Send them to the agent
const result = await client.invoke([system, greeting]);
console.log(result.messages);
```

---

## What you learned

- `Message` has four roles: `user`, `assistant`, `system`, and `tool`.
- `content` is always an array of typed `ContentBlock` objects.
- `Message.text_message()` is the easiest way to create a plain text message.
- `RemoteToolCallBlock` arrives from the server when a remote tool needs executing, and `invoke()` handles this automatically.
- Use `MediaRef` with `kind: 'file_id'` to reference files you have uploaded via `uploadFile()`.
- `Message.withImage()`, `Message.withFile()`, and `Message.multimodal()` build multimodal messages without hand-assembling blocks; `attach_media()` adds one to a message you already have.
- `message.text()` flattens content blocks to a string and is what you render for both final messages and streaming deltas.

## Next step

See [Files and multimodal](/docs/client/files-and-multimodal) for the end-to-end upload-and-send flow, or [invoke reference](/docs/reference/client/invoke) to learn how to send messages and receive responses.
