// FreeShow Church: one audio channel -> unsigned 8-bit samples for the LTC decoder (posted every ~20 ms)
const BUFFER_SIZE = 960

class ChurchLTCProcessor extends AudioWorkletProcessor {
    constructor() {
        super()
        this.buffer = new Uint8Array(BUFFER_SIZE)
        this.index = 0
    }

    process(inputs) {
        const channelData = inputs[0] && inputs[0][0]
        if (channelData) {
            for (let i = 0; i < channelData.length; i++) {
                const s = Math.max(-1, Math.min(1, channelData[i]))
                this.buffer[this.index++] = Math.min(255, Math.floor(s * 128 + 128))

                if (this.index >= BUFFER_SIZE) {
                    this.port.postMessage(this.buffer.slice(0, BUFFER_SIZE))
                    this.index = 0
                }
            }
        }
        return true
    }
}

registerProcessor("church-ltc-processor", ChurchLTCProcessor)
