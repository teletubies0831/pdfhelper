



















export type WritableFileStreamLike = {
  write(data: Blob | BufferSource | string): Promise<void>;
  close(): Promise<void>;
};


export type FileHandlePermissionDescriptor = {
  mode?: "read" | "readwrite";
};


export type FileHandlePermissionState = "granted" | "denied" | "prompt";


export type FileHandleLike = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableFileStreamLike>;
  isSameEntry?: (other: FileHandleLike) => Promise<boolean>;
  queryPermission?: (
    descriptor?: FileHandlePermissionDescriptor,
  ) => Promise<FileHandlePermissionState>;
  requestPermission?: (
    descriptor?: FileHandlePermissionDescriptor,
  ) => Promise<FileHandlePermissionState>;
};


export type FilePickerWindow = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileHandleLike[]>;
};
