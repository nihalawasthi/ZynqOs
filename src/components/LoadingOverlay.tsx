import React from 'react'

type LoadingOverlayProps = {
    messages?: string[]
}

const DEFAULT_MESSAGES = [
    'Booting ZynqOS core',
    'Mounting VFS and sample files',
    'Initializing WASI runtime',
    'Starting Python (Pyodide)',
    'Preparing window manager',
    'Syncing auth and settings',
    'Finalizing session startup',
]

export default function LoadingOverlay({ messages = DEFAULT_MESSAGES }: LoadingOverlayProps) {
    const [messageIndex, setMessageIndex] = React.useState(messages.length - 1)
    const lastChangeRef = React.useRef(performance.now())

    React.useEffect(() => {
        if (!messages.length) return
        const targetIndex = messages.length - 1

        if (targetIndex <= messageIndex) {
            setMessageIndex(targetIndex)
            lastChangeRef.current = performance.now()
            return
        }

        const elapsed = performance.now() - lastChangeRef.current
        const wait = Math.max(1000 - elapsed, 0)

        const timer = setTimeout(() => {
            setMessageIndex(targetIndex)
            lastChangeRef.current = performance.now()
        }, wait)

        return () => clearTimeout(timer)
    }, [messages, messageIndex])

    return (
        <div className="zynq-loader-overlay" role="status" aria-live="polite">
            <div className="flex flex-col items-center justify-center z-10 gap-0">
                <div className="scene">
                    <div className="forest">
                        <div className="tree tree1">
                            <div className="branch branch-top"></div>
                            <div className="branch branch-middle"></div>
                        </div>

                        <div className="tree tree2">
                            <div className="branch branch-top"></div>
                            <div className="branch branch-middle"></div>
                            <div className="branch branch-bottom"></div>
                        </div>

                        <div className="tree tree3">
                            <div className="branch branch-top"></div>
                            <div className="branch branch-middle"></div>
                            <div className="branch branch-bottom"></div>
                        </div>

                        <div className="tree tree4">
                            <div className="branch branch-top"></div>
                            <div className="branch branch-middle"></div>
                            <div className="branch branch-bottom"></div>
                        </div>

                        <div className="tree tree5">
                            <div className="branch branch-top"></div>
                            <div className="branch branch-middle"></div>
                            <div className="branch branch-bottom"></div>
                        </div>

                        <div className="tree tree6">
                            <div className="branch branch-top"></div>
                            <div className="branch branch-middle"></div>
                            <div className="branch branch-bottom"></div>
                        </div>

                        <div className="tree tree7">
                            <div className="branch branch-top"></div>
                            <div className="branch branch-middle"></div>
                            <div className="branch branch-bottom"></div>
                        </div>
                    </div>

                    <div className="tent">
                        <div className="roof"></div>
                        <div className="roof-border-left">
                            <div className="roof-border roof-border1"></div>
                            <div className="roof-border roof-border2"></div>
                            <div className="roof-border roof-border3"></div>
                        </div>
                        <div className="entrance">
                            <div className="door left-door">
                                <div className="left-door-inner"></div>
                            </div>
                            <div className="door right-door">
                                <div className="right-door-inner"></div>
                            </div>
                        </div>
                    </div>

                    <div className="floor">
                        <div className="ground ground1"></div>
                        <div className="ground ground2"></div>
                    </div>

                    <div className="fireplace">
                        <div className="support"></div>
                        <div className="support"></div>
                        <div className="bar"></div>
                        <div className="hanger"></div>
                        <div className="smoke"></div>
                        <div className="pan"></div>
                        <div className="fire">
                            <div className="line line1">
                                <div className="particle particle1"></div>
                                <div className="particle particle2"></div>
                                <div className="particle particle3"></div>
                                <div className="particle particle4"></div>
                            </div>
                            <div className="line line2">
                                <div className="particle particle1"></div>
                                <div className="particle particle2"></div>
                                <div className="particle particle3"></div>
                                <div className="particle particle4"></div>
                            </div>
                            <div className="line line3">
                                <div className="particle particle1"></div>
                                <div className="particle particle2"></div>
                                <div className="particle particle3"></div>
                                <div className="particle particle4"></div>
                            </div>
                        </div>
                    </div>

                    <div className="time-wrapper">
                        <div className="time">
                            <div className="day"></div>
                            <div className="night">
                                <div className="moon"></div>
                                <div className="star star1 star-big"></div>
                                <div className="star star2 star-big"></div>
                                <div className="star star3 star-big"></div>
                                <div className="star star4"></div>
                                <div className="star star5"></div>
                                <div className="star star6"></div>
                                <div className="star star7"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="status-bar" aria-hidden="true">
                    <div className="status-dot" />
                    <div className="status-text">{messages[messageIndex]}</div>
                </div>
            </div>

            <svg
                className="logo h-auto w-[21vw] md:w-[14vw]"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                xmlnsXlink="http://www.w3.org/1999/xlink"
                viewBox="0 0 1024 1024"
            >
                <path d="M611.7 250.6c-8.2 2-20.6 8.7-26.4 14.2-2.6 2.6-11.1 12.1-18.8 21.2-17.2 20.3-46.1 54.5-70 82.5-9.9 11.7-26.3 31-36.5 43s-26.6 31.3-36.5 43c-9.9 11.6-31.7 37.3-48.5 57.1-16.8 19.7-35.7 41.9-42 49.4-14.9 17.4-51.2 60.2-76 89.5-10.7 12.6-30 35.3-42.8 50.3s-24.7 29.4-26.3 32c-4.7 7.4-6.9 16-6.9 26.6 0 15.1 3.9 24.6 14.4 35.2 10.7 10.7 21.6 15.3 36.1 15.4 12.6 0 23.8-4.1 33.2-12.2 2.8-2.4 11.1-11.5 18.4-20.3 7.4-8.8 21.8-25.7 31.9-37.5 10.2-11.9 28-32.7 39.5-46.4 11.6-13.7 30.2-35.7 41.5-49s21.7-25.5 23.1-27.2l2.5-3.1 80.5-.6c88.7-.6 86.9-.5 97.8-7 20.2-12.1 26.3-40.1 13.2-60.5-5.7-8.8-11.7-13.4-23.5-18-3.5-1.4-10.8-1.7-48.4-2.2l-44.3-.5 12.3-14.6c6.8-8.1 19-22.7 27.3-32.5 8.2-9.9 24.9-29.6 37-43.9 12.2-14.3 30.8-36.3 41.5-49 10.7-12.6 25.3-29.7 32.3-38 7.1-8.2 14.1-17 15.7-19.4 6.6-9.9 9.9-24.4 8.1-35.9-2-12.8-5.8-20.6-14-28.8-11.8-11.8-29.3-16.7-45.4-12.8m20.8 6.9c12.3 3.2 22.3 11.2 27.5 22 8.2 17 5.2 35.8-8.2 51.6-3 3.5-22.3 26.2-42.9 50.5-20.6 24.2-50.2 59.3-65.9 77.9s-35.8 42.4-44.7 52.9c-9 10.5-16.3 19.4-16.3 19.8s23.1.8 51.3 1l51.2.3 5.8 2.4c21.5 8.9 29.6 36.5 16.1 54.7-4.9 6.6-10.6 10.8-18.4 13.4-6.4 2.2-7.4 2.2-88.2 2.8l-81.7.5-9.8 11.6c-5.5 6.4-27.6 32.5-49.3 58.1-21.6 25.6-41.7 49.2-44.5 52.5s-15.8 18.5-28.9 33.8c-13 15.3-25.6 29.2-27.9 30.9-7.1 5.2-14.5 8-22.7 8.5-18.3 1.3-34.6-8.1-42.7-24.4-3.2-6.5-3.7-8.6-4.1-16.3-.3-7 0-10.3 1.7-15.7 2.5-8.4 4.1-10.6 25.5-35.8 9.4-11 27.2-31.9 39.5-46.5 12.4-14.6 36.2-42.7 53-62.4 16.8-19.8 34.4-40.5 39.1-46 4.7-5.6 22.5-26.5 39.5-46.5 17.1-20.1 41.4-48.7 54-63.6 93.1-109.9 140.9-166 146.7-172 8-8.4 15.8-13.3 24.7-15.7 8.3-2.1 13.1-2.2 20.6-.3" />
                <path d="M612.5 261.3c-11.6 3.9-18.6 9.2-30.2 23-15 17.8-46.9 55.4-64.2 75.7-30 35.1-34.2 40-49.6 58.5-8.2 9.8-18.2 21.5-22 25.9-3.9 4.5-23.7 27.7-44 51.6s-48.2 56.7-61.9 72.9c-13.8 16.2-35.2 41.4-47.5 56-22.6 26.8-56.3 66.5-80.9 95.1-7.3 8.5-14.5 17.7-15.8 20.4-10.8 20.8-2.6 45.2 18.4 55.2 7.5 3.6 19.2 4.4 27.7 1.9 10.2-2.9 15-6.9 30.6-25.2 7.9-9.4 36.9-43.5 64.4-75.9 27.5-32.3 56.3-66.2 63.9-75.3l13.9-16.6 15.6-.6c8.6-.4 45.3-.7 81.6-.8 71.3-.1 73.6-.3 81.5-5.5 10.9-7.2 15.4-16.2 14.8-29.6-.5-10.8-3.8-17.4-11.7-23.6-9.5-7.5-8.8-7.4-69.4-7.7-29.5-.1-53.7-.4-53.7-.7 0-.6 7.7-9.8 67.4-80.5 72.1-85.3 87.8-103.9 98-115.5 18.6-21.3 20.9-25.7 21-41.5.1-8.9-.2-10.6-2.6-15.8-3.8-8.1-11.5-15.8-19.1-19.3-7.3-3.3-19.6-4.3-26.2-2.1m-355.2-8.8c-17.8 4.8-31.1 18.3-35.8 36-2.9 11.4-1.2 24.6 4.7 35.9 3.9 7.3 13.4 17.1 20.4 20.8 11.1 6 6.6 5.8 127.4 5.8 98.7 0 110.8-.2 112.8-1.6 1.2-.8 14-15.6 28.4-32.7 14.4-17.2 29.4-35 33.4-39.7 3.9-4.7 7.6-9.5 8.2-10.7 2.7-5 .7-11.4-4.3-13.8-2.9-1.3-19.2-1.5-146.7-1.4-119.9 0-144.2.3-148.5 1.4m292.1 6.1c.9.3 1.6 1.5 1.6 2.5 0 1.1-8.2 11.7-18.3 23.7-10 11.9-25.4 30.1-34 40.4L482.9 344l-16.7.1c-9.2 0-58.7 0-109.9-.1-102.3-.1-98.6.1-108.5-6.1-17.6-11.2-25.2-33.6-17.9-52.9 2.8-7.4 10.3-16.4 17.1-20.6 10.9-6.6 2-6.3 158.7-6.3 78.2-.1 142.8.2 143.7.5" />
                <path d="M256.2 264c-30.2 10.9-34.1 53.1-6.4 70.9 9.9 6.3 5.8 6.1 123.7 6.1h107.2l9.4-11.2c5.2-6.2 15.5-18.4 22.9-27.3s18.1-21.6 23.8-28.3l10.3-12.2H404.3c-137.7.1-143 .1-148.1 2m426.1 79.3c-1.1.7-7 6.8-12.9 13.7-37.9 44.1-46.6 54.4-47.4 56.6-1.3 3.3-.2 7.8 2.4 10.3 1.2 1.1 6.4 3.4 11.6 5.1 53 17.2 92.1 61 101.7 114.3 2.2 12.4 2.2 37 0 49.4-3.4 18.6-13.2 43.3-22.7 57.3-14.1 20.7-35.6 38.8-59.5 50.1-22.6 10.7-40.9 14.4-66.5 13.6-23.2-.8-37.8-4.3-58.6-14.1-29-13.8-53.9-36.8-68.3-63.2-3-5.5-6.3-10.9-7.4-12.1-2.4-2.7-6.5-3.7-9.9-2.4-2.3.9-57.4 63.1-62 70-1 1.4-1.8 3.8-1.8 5.2 0 3.2 5.1 11.6 13.7 22.7 28.3 36.3 72.8 67.5 117.8 82.6 68.1 22.9 143.1 15.8 204.5-19.3 22.4-12.7 36.7-23.7 54.5-41.5 39.5-39.6 64-93.1 69.4-151.6 5.6-60-12.7-121.9-50.8-171.8-22.9-30.1-56.1-56.9-89.1-71.9-9.8-4.4-14.7-5.2-18.7-3m23.2 13.2c32.6 16.6 63.1 43.3 85.7 75 30.4 42.7 46.9 101.2 43 152.8-4.5 59.7-29.1 114.1-69.7 154.1-19.6 19.3-37.8 32.2-63 44.7-55.4 27.4-117.3 33-176.2 15.8-53.5-15.5-102.3-50.1-132.4-93.6-4.6-6.7-5.1-7.8-3.9-9.6 2.9-4.7 58.4-67.7 59.3-67.4.6.2 3.3 4.3 6 9.3 23.3 42.1 63.7 71.5 111.2 81.1 12.8 2.5 44.6 2.5 56.5 0 41.5-9 76.7-32.1 98.5-64.7 32.8-49 35-112.9 5.5-162.3-18.9-31.7-49.2-56.2-84-67.8-11.4-3.8-13.9-5.1-14-7.1 0-.9 56.4-66.7 58.3-67.9 1.4-1 5.7.7 19.2 7.6" />
                <path d="M672.7 369.7c-27.9 32.3-39.8 46.5-39.5 46.9.2.2 5.1 2 10.8 4 56.2 19.5 96.9 68.3 104.9 125.8 1.8 12.7 1.4 34.8-.9 48.2-3.3 19.1-11.9 42-21.7 57.7-5.2 8.3-15.2 20.4-23.9 28.7-45.2 43.2-109.6 55.4-168.4 32.1-34.8-13.9-65-40.7-83-73.8l-3.4-6.2-3.1 3.7c-1.6 2-9.5 11.1-17.4 20.2-12.1 13.9-28.6 33-33.8 39.1-1.3 1.5-.4 3.1 7.5 13.5 32.3 42.8 82.3 75.4 135.4 88.4 22.1 5.4 31.3 6.5 56.8 6.5 25.7 0 34.1-.9 54-5.7 44-10.6 81.3-30.8 112.4-60.8 13.7-13.3 21.7-22.8 32.3-38.8 18.1-27.3 30.3-58.3 36.4-92.9 3.1-17 3.4-55.9.6-71.8-4.6-26.1-11.1-46.7-21.6-68-19.9-40.2-47.1-71.4-83.4-95.3-10.6-7-32.1-18.2-35-18.2-.8 0-8 7.5-16 16.7" />
            </svg>
        </div>
    )
}
