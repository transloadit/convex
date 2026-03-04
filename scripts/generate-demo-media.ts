import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fal, type QueueStatus } from '@fal-ai/client'
import { loadEnv } from './env.ts'

loadEnv()

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'test/e2e/fixtures' },
    force: { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: false,
})

const outputDir = path.resolve(values.out ?? 'test/e2e/fixtures')
const force = Boolean(values.force)

const requireEnv = (name: string) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name} environment variable`)
  }
  return value
}

const imageModel = process.env.DEMO_IMAGE_MODEL ?? 'gemini-3-pro-image-preview'
const imageAspectRatio = process.env.DEMO_IMAGE_ASPECT ?? '4:3'
const googleKey = requireEnv('GOOGLE_GENERATIVE_AI_API_KEY')
const falKey = requireEnv('FAL_KEY')

fal.config({ credentials: falKey })

const negativePrompt =
  'blurry, distorted, deformed, extra limbs, text, watermark, logo, low quality, harsh shadows'

const imagePrompts = [
  {
    file: 'wedding-photo-01.png',
    prompt:
      'A candid wedding photo of a joyful couple walking down the aisle, warm golden light, elegant floral arch, guests softly blurred in background, realistic, magazine quality, natural skin tones, clean composition, no text or logos.',
  },
  {
    file: 'wedding-photo-02.png',
    prompt:
      'A lively wedding reception toast with friends clinking glasses, soft bokeh lights, modern venue decor, warm and inviting atmosphere, realistic photo, crisp focus, no text or logos.',
  },
]

const videoSpec = {
  file: 'wedding-video-01.mp4',
  prompt:
    'A couple slow dancing at their wedding reception, gentle swaying, warm string lights, cinematic but realistic, smooth motion, shallow depth of field.',
  duration: '5',
  sourceImage: 'wedding-photo-01.png',
}

const generateImage = async (prompt: string): Promise<Buffer> => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent?key=${googleKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: imageAspectRatio },
        },
      }),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Image generation error ${response.status}: ${text}`)
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ inlineData?: { data?: string } }>
      }
    }>
  }
  const imagePart = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)
  if (!imagePart?.inlineData?.data) {
    throw new Error('No image data returned by model.')
  }
  return Buffer.from(imagePart.inlineData.data, 'base64')
}

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true })
}

const ensureImage = async (file: string, prompt: string) => {
  const outputPath = path.join(outputDir, file)
  if (!force) {
    try {
      await fs.access(outputPath)
      console.log(`✓ ${file} (cached)`)
      return
    } catch {
      // continue
    }
  }

  console.log(`→ Generating ${file}`)
  const image = await generateImage(prompt)
  await fs.writeFile(outputPath, image)
}

const generateVideo = async () => {
  const outputPath = path.join(outputDir, videoSpec.file)
  if (!force) {
    try {
      await fs.access(outputPath)
      console.log(`✓ ${videoSpec.file} (cached)`)
      return
    } catch {
      // continue
    }
  }

  const framePath = path.join(outputDir, videoSpec.sourceImage)
  const frameBuffer = await fs.readFile(framePath)
  const file = new File([frameBuffer], 'frame.png', { type: 'image/png' })

  console.log('→ Uploading anchor frame for Kling')
  const imageUrl = await fal.storage.upload(file)

  console.log('→ Generating Kling 2.6 video')
  const result = await fal.subscribe('fal-ai/kling-video/v2.6/pro/image-to-video', {
    input: {
      prompt: videoSpec.prompt,
      start_image_url: imageUrl,
      duration: videoSpec.duration,
      generate_audio: false,
      negative_prompt: negativePrompt,
    },
    logs: false,
    onQueueUpdate: (update: QueueStatus) => {
      if (update.status === 'IN_PROGRESS') {
        process.stdout.write('  Status: processing...\r')
      }
    },
  })

  const videoUrl = result.data?.video?.url
  if (!videoUrl) {
    throw new Error('No video URL returned by Kling')
  }

  const response = await fetch(videoUrl)
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(outputPath, buffer)
}

const run = async () => {
  await ensureDir(outputDir)
  for (const { file, prompt } of imagePrompts) {
    await ensureImage(file, prompt)
  }
  await generateVideo()
  console.log('✓ Demo media generated')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
