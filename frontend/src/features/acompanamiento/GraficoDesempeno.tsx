import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

import { etiquetaMes, type MesDesempeno } from './tipos'

/** D40: registros por mes (en línea y sin conexión, apilados) y cumplimiento del mes (%). Apache ECharts (RQ_013). */
export default function GraficoDesempeno({ datos }: { datos: MesDesempeno[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const c = echarts.init(ref.current)
    c.setOption({
      animation: false, tooltip: { trigger: 'axis' }, legend: { top: 0 },
      grid: { left: 36, right: 44, top: 40, bottom: 28 },
      xAxis: { type: 'category', data: datos.map((d) => etiquetaMes(d.mes)) },
      yAxis: [{ type: 'value', name: 'Semanas', minInterval: 1 }, { type: 'value', max: 100, axisLabel: { formatter: '{value} %' }, splitLine: { show: false } }],
      series: [
        { name: 'En línea', type: 'bar', stack: 'reg', data: datos.map((d) => d.enLinea), itemStyle: { color: '#14538a' } },
        { name: 'Sin conexión', type: 'bar', stack: 'reg', data: datos.map((d) => d.sinConexion), itemStyle: { color: '#d97706' } },
        { name: 'Cumplimiento', type: 'line', yAxisIndex: 1, data: datos.map((d) => (d.programadas === 0 ? null : d.cumplimiento)), connectNulls: false, itemStyle: { color: '#1f9d63' }, lineStyle: { width: 3 }, tooltip: { valueFormatter: (v: number) => `${v} %` } },
      ],
    })
    const ro = new ResizeObserver(() => c.resize()); ro.observe(ref.current)
    return () => { ro.disconnect(); c.dispose() }
  }, [datos])
  return <div ref={ref} role="img" aria-label={`Registros y cumplimiento por mes: ${datos.map((d) => `${etiquetaMes(d.mes)} ${d.cumplimiento} %`).join(', ')}`} className="h-72 w-full" data-testid="grafico-desempeno" />
}
