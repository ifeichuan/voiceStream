import { TextMessagePartProvider } from "@assistant-ui/react";
import {
  StreamdownTextPrimitive,
  type StreamdownTextComponents,
} from "@assistant-ui/react-streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";

type MarkdownProps = {
  children: string;
  className?: string;
};

type MarkdownLinkProps = ComponentPropsWithoutRef<"a"> & {
  node?: unknown;
};

type MarkdownImageProps = ComponentPropsWithoutRef<"img"> & {
  node?: unknown;
};

function MarkdownLink({ node: _, href, onClick, ...props }: MarkdownLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;

    event.preventDefault();
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  };

  return <a {...props} href={href} onClick={handleClick} />;
}

function MarkdownImage({ node: _, alt }: MarkdownImageProps) {
  return <span className="markdown-image-placeholder">{alt || "图片"}</span>;
}

const components = {
  a: MarkdownLink,
  img: MarkdownImage,
} satisfies StreamdownTextComponents;

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <TextMessagePartProvider text={children} isRunning={false}>
      <StreamdownTextPrimitive
        mode="static"
        plugins={{ code, cjk }}
        components={components}
        security={{ allowDataImages: false, allowedImagePrefixes: [] }}
        containerClassName={className}
        className="markdown-content"
      />
    </TextMessagePartProvider>
  );
}
