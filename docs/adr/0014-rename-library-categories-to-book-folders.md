# Rename Library Categories to Book Folders

CReader will replace the old library category model with flat, single-owner **Book Folders**. This is a real domain rename (`folderId` / `folders`) rather than a UI-only wording change, while startup/library hydration remains compatible with old `categoryId` / `categories` data so existing local libraries keep their groupings. Old category colors are not part of the new folder model.

We chose this over keeping category names internally because the new interaction is drag-to-move folder membership, not multi-label tagging. Keeping the old category vocabulary would make future sidebar and library work carry a permanent translation tax.
