export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          created_at: string
          email: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      chats: {
        Row: {
          active: boolean
          chat_id: number
          created_at: string
          id: string
          language: string | null
          last_seen_at: string
          title: string | null
          type: string
          username: string | null
        }
        Insert: {
          active?: boolean
          chat_id: number
          created_at?: string
          id?: string
          language?: string | null
          last_seen_at?: string
          title?: string | null
          type?: string
          username?: string | null
        }
        Update: {
          active?: boolean
          chat_id?: number
          created_at?: string
          id?: string
          language?: string | null
          last_seen_at?: string
          title?: string | null
          type?: string
          username?: string | null
        }
        Relationships: []
      }
      published_history: {
        Row: {
          breaking: boolean
          category: string | null
          chat_id: number
          dedup_key: string
          headline: string | null
          id: string
          original_published_at: string | null
          published_at: string
          source_name: string | null
        }
        Insert: {
          breaking?: boolean
          category?: string | null
          chat_id: number
          dedup_key: string
          headline?: string | null
          id?: string
          original_published_at?: string | null
          published_at?: string
          source_name?: string | null
        }
        Update: {
          breaking?: boolean
          category?: string | null
          chat_id?: number
          dedup_key?: string
          headline?: string | null
          id?: string
          original_published_at?: string | null
          published_at?: string
          source_name?: string | null
        }
        Relationships: []
      }
      queue: {
        Row: {
          article_id: string | null
          breaking: boolean
          category: string
          created_at: string
          dedup_key: string
          headline: string
          id: string
          image_url: string | null
          original_published_at: string | null
          score: number
          score_parts: Json
          source_name: string
          status: string
          summary: string
          url: string
        }
        Insert: {
          article_id?: string | null
          breaking?: boolean
          category: string
          created_at?: string
          dedup_key: string
          headline: string
          id?: string
          image_url?: string | null
          original_published_at?: string | null
          score?: number
          score_parts?: Json
          source_name: string
          status?: string
          summary: string
          url: string
        }
        Update: {
          article_id?: string | null
          breaking?: boolean
          category?: string
          created_at?: string
          dedup_key?: string
          headline?: string
          id?: string
          image_url?: string | null
          original_published_at?: string | null
          score?: number
          score_parts?: Json
          source_name?: string
          status?: string
          summary?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "queue_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "raw_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_articles: {
        Row: {
          category: string | null
          dedup_key: string
          description: string | null
          fetched_at: string
          id: string
          image_url: string | null
          payload: Json
          provider: string
          published_at: string | null
          reject_reason: string | null
          rejected: boolean
          source_name: string | null
          title: string
          url: string
        }
        Insert: {
          category?: string | null
          dedup_key: string
          description?: string | null
          fetched_at?: string
          id?: string
          image_url?: string | null
          payload?: Json
          provider: string
          published_at?: string | null
          reject_reason?: string | null
          rejected?: boolean
          source_name?: string | null
          title: string
          url: string
        }
        Update: {
          category?: string | null
          dedup_key?: string
          description?: string | null
          fetched_at?: string
          id?: string
          image_url?: string | null
          payload?: Json
          provider?: string
          published_at?: string | null
          reject_reason?: string | null
          rejected?: boolean
          source_name?: string | null
          title?: string
          url?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          breaking_categories: string[]
          breaking_interrupts_night: boolean
          day_end: string
          day_max_minutes: number
          day_min_minutes: number
          day_start: string
          default_language: string
          event_cooldown_hours: number
          event_similarity_threshold: number
          gold_move_threshold: number
          id: number
          last_published_at: string | null
          next_publish_at: string | null
          night_end: string
          night_max_minutes: number
          night_min_minutes: number
          night_start: string
          oil_move_threshold: number
          timezone: string
          updated_at: string
        }
        Insert: {
          breaking_categories?: string[]
          breaking_interrupts_night?: boolean
          day_end?: string
          day_max_minutes?: number
          day_min_minutes?: number
          day_start?: string
          default_language?: string
          event_cooldown_hours?: number
          event_similarity_threshold?: number
          gold_move_threshold?: number
          id?: number
          last_published_at?: string | null
          next_publish_at?: string | null
          night_end?: string
          night_max_minutes?: number
          night_min_minutes?: number
          night_start?: string
          oil_move_threshold?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          breaking_categories?: string[]
          breaking_interrupts_night?: boolean
          day_end?: string
          day_max_minutes?: number
          day_min_minutes?: number
          day_start?: string
          default_language?: string
          event_cooldown_hours?: number
          event_similarity_threshold?: number
          gold_move_threshold?: number
          id?: number
          last_published_at?: string | null
          next_publish_at?: string | null
          night_end?: string
          night_max_minutes?: number
          night_min_minutes?: number
          night_start?: string
          oil_move_threshold?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      sources: {
        Row: {
          config: Json
          created_at: string
          daily_quota: number | null
          enabled: boolean
          id: string
          kind: string
          last_error: string | null
          name: string
          priority: number
          quota_date: string
          secret_ref: string | null
          used_today: number
        }
        Insert: {
          config?: Json
          created_at?: string
          daily_quota?: number | null
          enabled?: boolean
          id?: string
          kind: string
          last_error?: string | null
          name: string
          priority?: number
          quota_date?: string
          secret_ref?: string | null
          used_today?: number
        }
        Update: {
          config?: Json
          created_at?: string
          daily_quota?: number | null
          enabled?: boolean
          id?: string
          kind?: string
          last_error?: string | null
          name?: string
          priority?: number
          quota_date?: string
          secret_ref?: string | null
          used_today?: number
        }
        Relationships: []
      }
      topic_queries: {
        Row: {
          category: string
          created_at: string
          enabled: boolean
          id: string
          query: string
        }
        Insert: {
          category?: string
          created_at?: string
          enabled?: boolean
          id?: string
          query: string
        }
        Update: {
          category?: string
          created_at?: string
          enabled?: boolean
          id?: string
          query?: string
        }
        Relationships: []
      }
      translation_failures: {
        Row: {
          created_at: string
          dedup_key: string | null
          detail: string | null
          headline: string | null
          id: string
          models_tried: string[]
          target_language: string
        }
        Insert: {
          created_at?: string
          dedup_key?: string | null
          detail?: string | null
          headline?: string | null
          id?: string
          models_tried?: string[]
          target_language: string
        }
        Update: {
          created_at?: string
          dedup_key?: string | null
          detail?: string | null
          headline?: string | null
          id?: string
          models_tried?: string[]
          target_language?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
