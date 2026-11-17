import { z } from 'zod';

export const uploadSchema = z.object({
  file: z
    .custom<File>(
      (value) => typeof File !== 'undefined' && value instanceof File,
      'Choose one file.',
    )
    .refine((file) => !file || file.size > 0, 'The file is empty.')
    .refine(
      (file) => !file || file.size <= 10 * 1024 * 1024,
      'Choose a file no larger than 10 MiB.',
    )
    .refine(
      (file) => !file || /\.(pdf|txt|md|markdown)$/i.test(file.name),
      'Choose a PDF, TXT, or Markdown file.',
    ),
});
